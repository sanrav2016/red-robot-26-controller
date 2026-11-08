import { useState, useRef, useEffect } from 'react'
import './App.css'
import bkg from './assets/background.png'
import Joystick from './Joystick'
import Dpad from './Dpad'
import XYAB from './XYAB'
import { RotationContext } from './rotation'

// Which way the UI turns when the phone is held in portrait: 90 or -90.
const PORTRAIT_ROTATION = 90;

// BLE timing
const RECONNECT_TIMEOUT_MS = 20000;       // after this long, "Reconnecting..." becomes "Disconnected"
const CONNECT_ATTEMPT_TIMEOUT_MS = 8000;  // one connect attempt
const WRITE_TIMEOUT_MS = 2000;            // a write that never resolves counts as failed
const FAILURE_WINDOW_MS = 5000;           // failures further apart than this don't add up
const MAX_WRITE_FAILURES = 4;             // consecutive failed writes before forcing a reconnect

function useLandscapeKey() {
  const mq = () => window.matchMedia('(orientation: landscape)').matches;
  const [landscape, setLandscape] = useState(mq);
  const [key, setKey] = useState(0);

  useEffect(() => {
    let t;
    const update = () => {
      clearTimeout(t);
      setLandscape(mq());
      // wait for iOS to settle the viewport, then remount fresh
      t = setTimeout(() => setKey(k => k + 1), 300);
    };
    const onFs = () => {
      // fullscreen toggle: remount once the viewport has settled
      clearTimeout(t);
      t = setTimeout(() => {
        setLandscape(mq());
        setKey(k => k + 1);
      }, 300);
    };

    const m = window.matchMedia('(orientation: landscape)');
    m.addEventListener('change', update);
    document.addEventListener('fullscreenchange', onFs);
    document.addEventListener('webkitfullscreenchange', onFs);
    return () => {
      clearTimeout(t);
      m.removeEventListener('change', update);
      document.removeEventListener('fullscreenchange', onFs);
      document.removeEventListener('webkitfullscreenchange', onFs);
    };
  }, []);

  return { landscape, key };
}

export function useManualButtons(writeToBle) {
  const writeRef = useRef(writeToBle);
  writeRef.current = writeToBle;

  useEffect(() => {
    const active = new Map(); // pointerId -> element currently held

    const hit = (x, y) => {
      for (const el of document.querySelectorAll('[data-ble]')) {
        const r = el.getBoundingClientRect();
        if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return el;
      }
      return null;
    };

    const press = (el) => {
      el.classList.add('pressed');
      writeRef.current(el.dataset.ble, '1');
    };
    const release = (el) => {
      el.classList.remove('pressed');
      writeRef.current(el.dataset.ble, '0');
    };

    const down = (e) => {
      const el = hit(e.clientX, e.clientY);
      if (!el) return;
      active.set(e.pointerId, el);
      press(el);
    };

    const move = (e) => {
      const prev = active.get(e.pointerId);
      if (!prev) return;
      const el = hit(e.clientX, e.clientY);
      if (el === prev) return;
      release(prev);
      if (el) {
        active.set(e.pointerId, el);
        press(el);
      } else {
        active.delete(e.pointerId);
      }
    };

    const up = (e) => {
      const el = active.get(e.pointerId);
      if (!el) return;
      active.delete(e.pointerId);
      release(el);
    };

    window.addEventListener('pointerdown', down, true);
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', up, true);
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', up, true);
    };
  }, []);
}

const LS_ID = 'rr-last-device-id';
const LS_TEAM = 'rr-team-num';
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };
// 1, 01, 0001 -> "01"; 62 -> "62"; 100 -> "100"; nothing typed -> ""
const normalizeTeam = (raw) => {
  const digits = String(raw ?? '').replace(/[^0-9]/g, '');
  if (!digits) return '';
  return digits.replace(/^0+/, '').padStart(2, '0');
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Reject if a BLE call hangs (they can, on a flaky link) so nothing waits forever.
const withTimeout = (promise, ms, label) => {
  let t;
  const timeout = new Promise((_, reject) => {
    t = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
};

function App() {
  const deviceRef = useRef(null);
  const rxCharacteristicRef = useRef(null);
  const [bleConnected, setBleConnected] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [status, setStatus] = useState('Disconnected');
  const [error, setError] = useState('');
  const writeQueueRef = useRef([]);
  const isProcessingQueueRef = useRef(false);
  const writeFailuresRef = useRef(0);
  const lastFailureAtRef = useRef(0);
  const [teamNum, setTeamNum] = useState(() => lsGet(LS_TEAM) || undefined);
  const [teamNumNumeric, setTeamNumNumeric] = useState(() => lsGet(LS_TEAM) || '');
  const manualDisconnectRef = useRef(false);   // true after the user taps Disconnect / Cancel
  const busyRef = useRef(false);               // a reconnect loop is running
  const connectedRef = useRef(false);
  const genRef = useRef(0);                    // bumped to cancel an in-flight reconnect loop
  const stopWatchRef = useRef(null);           // tears down a pending "wait for advertisement"
  const errorTimerRef = useRef(null);
  const requestIdRef = useRef(0);

  const blePrefix = "RR-";

  const { landscape, key } = useLandscapeKey();

  useEffect(() => {
    screen.orientation?.lock?.('portrait').catch(() => { });  // works on some platforms only (e.g. installed Android PWA)
  }, []);

  const handleTeamNumChange = (e) => {
    const rawValue = e.target.value;
    const numericValue = rawValue.replace(/[^0-9]/g, '');
    setTeamNum(numericValue);
    setTeamNumNumeric(numericValue);
    lsSet(LS_TEAM, numericValue);
  };

  // Nordic UART service (NUS) UUIDs
  const SERVICE_UUID = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
  const CHARACTERISTIC_UUID_RX = "6e400002-b5a3-f393-e0a9-e50e24dcca9e";
  const CHARACTERISTIC_UUID_TX = "6e400003-b5a3-f393-e0a9-e50e24dcca9e";

  // Errors from writes show briefly instead of replacing the status forever.
  const flashError = (msg) => {
    setError(msg);
    clearTimeout(errorTimerRef.current);
    errorTimerRef.current = setTimeout(() => setError(''), 3000);
  };

  // Forget everything tied to the current link. Queued commands are dropped on purpose:
  // replaying old drive commands after a reconnect would be dangerous.
  const resetLink = () => {
    rxCharacteristicRef.current = null;
    writeQueueRef.current = [];
    writeFailuresRef.current = 0;
    connectedRef.current = false;
    setBleConnected(false);
  };

  // Stable listener identity so we never stack duplicate disconnect handlers.
  const disconnectHandlerRef = useRef(null);
  const stableDisconnect = useRef((e) => disconnectHandlerRef.current?.(e)).current;

  const connectToDevice = async (device, { reconnecting: isReconnect = false, isCancelled = () => false } = {}) => {
    const name = device.name || 'unknown device';
    setStatus(`${isReconnect ? 'Reconnecting to' : 'Connecting to'} ${name}...`);
    deviceRef.current = device;
    device.removeEventListener('gattserverdisconnected', stableDisconnect);
    device.addEventListener('gattserverdisconnected', stableDisconnect);

    let rx;
    try {
      const server = await withTimeout(device.gatt.connect(), CONNECT_ATTEMPT_TIMEOUT_MS, 'Connect');
      const service = await withTimeout(server.getPrimaryService(SERVICE_UUID), CONNECT_ATTEMPT_TIMEOUT_MS, 'Service lookup');
      rx = await withTimeout(service.getCharacteristic(CHARACTERISTIC_UUID_RX), CONNECT_ATTEMPT_TIMEOUT_MS, 'Characteristic lookup');
      if (isCancelled()) throw new Error('Cancelled');
    } catch (err) {
      try { device.gatt.disconnect(); } catch { /* ignore */ }   // abort a half-open attempt
      throw err;
    }

    rxCharacteristicRef.current = rx;
    writeQueueRef.current = [];
    writeFailuresRef.current = 0;
    lsSet(LS_ID, device.id);
    connectedRef.current = true;
    setReconnecting(false);
    setError('');
    setStatus('Connected to ' + name);
    setBleConnected(true);
  };

  // Stop any reconnect loop / advertisement wait that is still running.
  const supersedeReconnect = () => {
    genRef.current += 1;
    stopWatchRef.current?.();
  };

  // Retry quietly (no chooser, no user gesture needed). Gives up after RECONNECT_TIMEOUT_MS.
  const reconnect = async (device) => {
    if (!device || busyRef.current || manualDisconnectRef.current) return false;
    busyRef.current = true;
    const gen = ++genRef.current;
    const cancelled = () => gen !== genRef.current || manualDisconnectRef.current;

    setReconnecting(true);
    setStatus(`Reconnecting to ${device.name || 'robot'}...`);
    const deadline = Date.now() + RECONNECT_TIMEOUT_MS;
    let attempt = 0;
    try {
      while (Date.now() < deadline) {
        if (cancelled() || connectedRef.current) return false;
        try {
          await connectToDevice(device, { reconnecting: true, isCancelled: cancelled });
          return true;
        } catch (err) {
          console.warn('Reconnect attempt failed:', err.message);
        }
        await sleep(Math.min(1000 * ++attempt, 3000));
      }
      if (!cancelled()) setStatus('Disconnected');
      return false;
    } finally {
      busyRef.current = false;
      if (gen === genRef.current) setReconnecting(false);
    }
  };

  // The link dropped (event from the browser, or we gave up on a stuck link).
  const handleLinkLost = (dev) => {
    if (!connectedRef.current) return;   // already handled, or a connect attempt that never finished
    resetLink();
    if (manualDisconnectRef.current) {
      setStatus('Disconnected');
      return;
    }
    // Dropped unexpectedly (out of range, robot reset, app backgrounded): try to get back.
    reconnect(dev ?? deviceRef.current);
  };

  // On launch / return to foreground: reconnect to a robot this browser already has permission for.
  // Needs navigator.bluetooth.getDevices(); silently does nothing where that's unsupported.
  const autoConnect = async () => {
    if (connectedRef.current || busyRef.current || manualDisconnectRef.current) return;
    if (!navigator.bluetooth?.getDevices) return;
    try {
      const devices = await navigator.bluetooth.getDevices();
      const savedId = lsGet(LS_ID);
      const team = normalizeTeam(lsGet(LS_TEAM));   // read fresh: this function runs from a mount-time closure
      const prefix = team ? `${blePrefix}${team}` : null;
      const dev =
        devices.find((d) => d.id === savedId) ??
        (prefix ? devices.find((d) => d.name?.startsWith(prefix)) : undefined);
      if (!dev) return;

      if (typeof dev.watchAdvertisements === 'function') {
        // Wait until the robot is actually advertising, then connect. Give up after a while.
        stopWatchRef.current?.();
        setStatus(`Looking for ${dev.name || 'robot'}...`);
        setReconnecting(true);

        const ac = new AbortController();
        let found = false;
        let timer;
        const onAdvert = () => {
          found = true;
          stopWatch();
          reconnect(dev);
        };
        const stopWatch = () => {
          clearTimeout(timer);
          dev.removeEventListener('advertisementreceived', onAdvert);
          ac.abort();
          if (stopWatchRef.current === stopWatch) stopWatchRef.current = null;
        };
        stopWatchRef.current = stopWatch;
        timer = setTimeout(() => {
          stopWatch();
          setReconnecting(false);
          setStatus('Disconnected');
        }, RECONNECT_TIMEOUT_MS);
        dev.addEventListener('advertisementreceived', onAdvert, { once: true });

        try {
          await dev.watchAdvertisements({ signal: ac.signal });
        } catch {
          if (!found && stopWatchRef.current === stopWatch) {
            stopWatch();
            reconnect(dev);   // watching not allowed -> just try to connect
          }
        }
      } else {
        reconnect(dev);
      }
    } catch (err) {
      console.warn('Auto-connect unavailable:', err.message);
    }
  };

    const connectBle = async () => {
    console.log('Requesting Bluetooth device...');
    supersedeReconnect();
    manualDisconnectRef.current = false;
    setError('');
    setStatus('Choose a device...');

    let requestObj = {
      acceptAllDevices: true,
      optionalServices: [SERVICE_UUID]
    };

    const team = normalizeTeam(teamNumNumeric);
    console.log(`${blePrefix}${team}`)

    if (team) {
      // iOS Bluefy only filters with namePrefix but breaks on Android
      // Android can have service filter but breaks on iOS
      // LOLOLOLOLOL
      const isIOS =
        /iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

      const prefix = `${blePrefix}${team}`;

      requestObj = {
        filters: [
          isIOS
            ? { namePrefix: prefix } // Bluefy: name only
            : { namePrefix: prefix, services: [SERVICE_UUID] }, // Chrome: name and service
        ],
        optionalServices: [SERVICE_UUID],
      };
    }

    // Only the newest request may act on its result.
    const myRequest = ++requestIdRef.current;
    const isCurrent = () => requestIdRef.current === myRequest;

    // Some browsers (e.g. Bluefy) never settle requestDevice() when the picker is dismissed,
    // so don't leave "Choose a device..." on screen forever.
    const idleTimer = setTimeout(() => {
      if (isCurrent() && !connectedRef.current) setStatus('Disconnected');
    }, 10000);

    try {
      const selectedDevice = await navigator.bluetooth.requestDevice(requestObj);
      clearTimeout(idleTimer);
      if (!isCurrent()) return;   // a newer Connect tap replaced this request
      await connectToDevice(selectedDevice);
    } catch (err) {
      clearTimeout(idleTimer);
      if (!isCurrent()) return;
      console.error(err.message);
      if (err.name === 'NotFoundError') {
        // picker closed without choosing, or nothing matched: not an error
        setStatus('No device selected');
        return;
      }
      if (!navigator.bluetooth || err.message.includes('Web Bluetooth API')) {
        setError("Error: Web Bluetooth not available.");
      } else {
        flashError("There was an error, please try again.");
      }
      setStatus('Disconnected');
    }
  };

  // Always works, even if the link is half-dead: resets our state no matter what the browser says.
  const disconnectBle = () => {
    manualDisconnectRef.current = true;
    supersedeReconnect();
    const dev = deviceRef.current;
    resetLink();
    setReconnecting(false);
    setError('');
    setStatus('Disconnected');
    try {
      if (dev?.gatt?.connected) dev.gatt.disconnect();
    } catch { /* ignore */ }
  };

  // Cancel button while "Reconnecting..." is showing.
  const cancelReconnect = () => {
    manualDisconnectRef.current = true;
    supersedeReconnect();
    setReconnecting(false);
    setStatus('Disconnected');
  };

  const writeToBle = async (key, value) => {
    // packet structure: 4 bytes
    // ~ (char), then header (1-2 char), then payload (1-2 int8)
    const totalBytes = 1 + key.length + value.length;
    const buffer = new ArrayBuffer(totalBytes);
    const view = new DataView(buffer);
    let offset = 0;
    view.setUint8(offset, "~".charCodeAt(0));
    offset++;
    for (let i = 0; i < key.length; i++) {
      view.setUint8(offset + i, key.charCodeAt(i));
    }
    offset += key.length;
    for (let i = 0; i < value.length; i++) {
      view.setInt8(offset + i, value[i]);
    }
    // joystick values are arrays; only the latest one per stick matters
    queueCommand(buffer, key, Array.isArray(value));
  };

  useManualButtons(writeToBle);

  const processQueue = async () => {
    if (isProcessingQueueRef.current) return;
    isProcessingQueueRef.current = true;
    try {
      while (writeQueueRef.current.length > 0) {
        const ch = rxCharacteristicRef.current;
        const dev = deviceRef.current;
        if (!ch) {
          writeQueueRef.current = [];
          break;
        }
        const item = writeQueueRef.current.shift();
        try {
          await withTimeout(ch.writeValueWithoutResponse(item.buf), WRITE_TIMEOUT_MS, 'Write');
          writeFailuresRef.current = 0;
        } catch (err) {
          if (rxCharacteristicRef.current !== ch) break;      // link was reset while writing
          if (!dev?.gatt?.connected) {                         // link is gone: recover instead of erroring
            handleLinkLost(dev);
            break;
          }
          // Writes only happen on input, so don't let failures from minutes apart add up.
          const now = Date.now();
          if (now - lastFailureAtRef.current > FAILURE_WINDOW_MS) writeFailuresRef.current = 0;
          lastFailureAtRef.current = now;
          writeFailuresRef.current += 1;
          if (writeFailuresRef.current >= MAX_WRITE_FAILURES) {
            // Link is up on paper but nothing goes through: tear it down and reconnect.
            try { dev.gatt.disconnect(); } catch { /* ignore */ }
            handleLinkLost(dev);
            break;
          }
          // Buttons matter (press/release), so retry them a couple of times; stick updates are just replaced by newer ones.
          if (!item.stream && ++item.tries < 3) writeQueueRef.current.unshift(item);
          const msg = err?.message || '';
          if (!/in progress/i.test(msg)) flashError(msg || 'Failed to send data');
          await sleep(25);
        }
      }
    } finally {
      isProcessingQueueRef.current = false;
      // commands that arrived while an old loop was winding down
      if (writeQueueRef.current.length > 0 && rxCharacteristicRef.current) processQueue();
    }
  };

  const queueCommand = (buf, key, stream) => {
    if (!rxCharacteristicRef.current) return;   // not connected: drop it, don't hoard it
    const q = writeQueueRef.current;
    if (stream) {
      // keep only the newest pending update per stick so the queue can't pile up
      const pending = q.find((c) => c.stream && c.key === key);
      if (pending) {
        pending.buf = buf;
        processQueue();
        return;
      }
    }
    q.push({ buf, key, stream, tries: 0 });
    processQueue();
  };

  const onBleDisconnected = (event) => {
    handleLinkLost(event.target);
  };
  disconnectHandlerRef.current = onBleDisconnected;

  useEffect(() => {
    autoConnect();
    const onVisible = () => { if (document.visibilityState === 'visible') autoConnect(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      stopWatchRef.current?.();
      clearTimeout(errorTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rot = landscape ? 0 : PORTRAIT_ROTATION;
  const shellStyle = rot === 0
    ? { position: 'fixed', top: 0, left: 0, width: '100dvw', height: '100dvh' }
    : {
        position: 'fixed', top: 0, left: 0,
        width: '100dvh', height: '100dvw',      // swapped: this box is turned 90deg
        transformOrigin: 'top left',
        transform: rot === 90 ? 'translateX(100dvw) rotate(90deg)' : 'translateY(100dvh) rotate(-90deg)',
      };

  // `sm:` looks at the screen, not the turned layout, so pick the sizes by hand when rotated.
  const ctlScale = rot ? 'scale-100' : 'scale-90 sm:scale-100';

  const mainButtonLabel = bleConnected ? 'Disconnect' : reconnecting ? 'Cancel' : 'Connect';
  const mainButtonAction = bleConnected ? disconnectBle : reconnecting ? cancelReconnect : connectBle;

  return (
    <RotationContext.Provider value={rot}>
      <div key={key} style={shellStyle}>
        <div className={`w-full h-full bg-gradient-to-l from-rose-600 to-slate-700 bg-[length:200%_auto] ${!bleConnected ? "animate-gradient-shift" : ""} transition-all relative flex flex-col items-center justify-between overflow-hidden m-0 p-3 select-none touch-none`}>
          <div className="opacity-10 blur-[2px] contrast-200 absolute top-0 left-0 w-full h-full" style={{
            backgroundImage: `url(${bkg})`,
            backgroundAttachment: 'fixed',
            backgroundPosition: 'center',
            backgroundRepeat: 'no-repeat',
            backgroundSize: 'cover',
          }}></div>
          <div className="absolute top-0 left-0 w-full h-full flex flex-col justify-center items-center gap-2">
            <span className="text-slate-300 text-md font-bold font-medium">{blePrefix}</span>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={teamNum ?? ''}
              placeholder="XX"
              onChange={handleTeamNumChange}
              className="w-18 py-3 px-4 text-base font-bold text-slate-200 bg-slate-900 border-[1.5px] border-slate-700 rounded-lg outline-none transition-all duration-200 ease-in-out shadow-sm text-center placeholder:text-slate-600 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/15"
            />
          </div>
          <div className="absolute top-0 flex flex-col items-center justify-center shrink-0 z-20">
            <div className="flex items-center justify-center gap-3 z-10">
              <button className={`px-4 py-2 ${!bleConnected ? "bg-slate-800" : "bg-red-400"} text-white rounded-b-lg mb-1`} onClick={mainButtonAction}>
                {mainButtonLabel}
              </button>
            </div>
            <span className={`text-center text-xs px-1 rounded-full bg-slate-900/50 ${error != '' ? 'text-red-400' : 'text-white'}`}>
              {error != '' ? error : status}
            </span>
          </div>
          <div className={`w-full max-w-4xl flex-1 flex flex-col items-center justify-around ${rot ? 'px-10' : 'px-4 sm:px-10'} py-2`}>
            <div className="w-full flex items-center justify-between">
              <div className={`flex items-center justify-start shrink-0 ${ctlScale}`}>
                <Joystick writeToBle={writeToBle} jid="J" />
              </div>
              <div className={`flex items-center justify-end shrink-0 ${ctlScale}`}>
                <XYAB writeToBle={writeToBle} />
              </div>
            </div>
            <div className="w-full flex items-center justify-between px-[10%]">
              <div className={`flex items-center justify-start shrink-0 ${ctlScale}`}>
                <Dpad writeToBle={writeToBle} />
              </div>
              <div className={`flex items-center justify-end shrink-0 ${ctlScale}`}>
                <Joystick writeToBle={writeToBle} jid="I" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </RotationContext.Provider>
  )
}

export default App