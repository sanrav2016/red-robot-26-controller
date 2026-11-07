import { useState, useRef, useEffect } from 'react'
import './App.css'
import favicon from './assets/favicon.png'
import bkg from './assets/background.png'
import Joystick from './Joystick'
import Dpad from './Dpad'
import XYAB from './XYAB'

function useLandscapeKey() {
  const mq = () => window.matchMedia('(orientation: landscape)').matches;
  const [landscape, setLandscape] = useState(mq);
  const [key, setKey] = useState(0);

  useEffect(() => {
    let t;
    const update = () => {
      clearTimeout(t);
      const next = mq();
      if (!next) {
        setLandscape(false);              // unmount immediately in portrait
      } else {
        // wait for iOS to settle the viewport, then mount fresh
        t = setTimeout(() => {
          setLandscape(true);
          setKey(k => k + 1);
        }, 300);
      }
    };
    const onFs = () => {
      // fullscreen toggle: tear down and remount too
      setLandscape(false);
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

function App() {
  const deviceRef = useRef(null);
  const rxCharacteristicRef = useRef(null);
  const [bleConnected, setBleConnected] = useState(false);
  const [status, setStatus] = useState('Disconnected');
  const [error, setError] = useState('');
  const writeQueueRef = useRef([]);
  const isProcessingQueueRef = useRef(false);
  const [teamNum, setTeamNum] = useState(undefined);
  const [teamNumNumeric, setTeamNumNumeric] = useState(0);

  const blePrefix = "RR-";

  const { landscape, key } = useLandscapeKey();

  useEffect(() => {
    screen.orientation?.lock?.('landscape').catch(() => { });  // works on some platforms only
  }, []);

  const handleTeamNumChange = (e) => {
    const rawValue = e.target.value;
    const numericValue = rawValue.replace(/[^0-9]/g, '');
    setTeamNum(numericValue);
    const num = parseInt(numericValue, 10);
    const formatted = String(num).padStart(2, '0');
    setTeamNumNumeric(numericValue);
  };

  // Nordic UART service (NUS) UUIDs
  const SERVICE_UUID = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
  const CHARACTERISTIC_UUID_RX = "6e400002-b5a3-f393-e0a9-e50e24dcca9e";
  const CHARACTERISTIC_UUID_TX = "6e400003-b5a3-f393-e0a9-e50e24dcca9e";

  const connectBle = async () => {
    console.log('Requesting Bluetooth device...');
    setError('');
    setStatus('Requesting device...');

    let requestObj = {
      acceptAllDevices: true,
      optionalServices: [SERVICE_UUID]
    };

    if (teamNum && teamNumNumeric != NaN) requestObj = {
      filters: [{
        namePrefix: `${blePrefix}${teamNumNumeric}`,
        services: [SERVICE_UUID]
      }],
      optionalServices: [SERVICE_UUID]
    };

    try {
      const selectedDevice = await navigator.bluetooth.requestDevice(requestObj);
      setStatus(`Connecting to ${selectedDevice.name || 'unknown device'}...`);
      deviceRef.current = selectedDevice;
      const server = await selectedDevice.gatt.connect();
      const service = await server.getPrimaryService(SERVICE_UUID);
      const rxCharacteristic = await service.getCharacteristic(CHARACTERISTIC_UUID_RX);
      rxCharacteristicRef.current = rxCharacteristic;
      setStatus('Connected to ' + (selectedDevice.name || 'unknown device'));
      setBleConnected(true);
      selectedDevice.addEventListener('gattserverdisconnected', onBleDisconnected);
    } catch (err) {
      setError(!navigator.bluetooth || err.message.includes('Web Bluetooth API') ? "Error: Web Bluetooth not available." : "There was an error, please try again.");
      console.error(err.message);
      setStatus('Disconnected');
    }
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
    queueCommand(buffer);
  };

  useManualButtons(writeToBle);

  const processQueue = async () => {
    if (!rxCharacteristicRef.current || isProcessingQueueRef.current || writeQueueRef.current.length === 0) return;

    isProcessingQueueRef.current = true;
    const nextCommand = writeQueueRef.current.shift();

    try {
      await rxCharacteristicRef.current.writeValueWithoutResponse(nextCommand);
    } catch (err) {
      console.error('Write error:', err);
      setError(err.message || 'Failed to send data');
    } finally {
      isProcessingQueueRef.current = false;
      processQueue(); // recursive
    }
  };

  const queueCommand = (commandPacket) => {
    writeQueueRef.current.push(commandPacket);
    processQueue();
  };

  const onBleDisconnected = (event) => {
    const dev = event.target;
    setStatus(`Disconnected from ${dev.name || 'unknown device'}`);
    deviceRef.current = null;
    rxCharacteristicRef.current = null;
    setBleConnected(false);
  };

  const disconnectBle = () => {
    if (deviceRef.current && deviceRef.current.gatt.connected) {
      deviceRef.current.gatt.disconnect();
    }
  };

  return landscape ? (
    <div key={key}>
      <link rel="icon" type="image/png" href={favicon} />
      <div className="w-[100dvw] h-[100dvh] bg-gradient-to-l from-black to-gray-900 relative flex flex-col items-center justify-between overflow-hidden m-0 p-3 select-none touch-none">"
        <div className="opacity-5 blur-[2px] contrast-200 absolute top-0 left-0 w-full h-full" style={{
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
            value={teamNum}
            placeholder="XX"
            onChange={handleTeamNumChange}
            className="w-18 py-3 px-4 text-base font-bold text-slate-200 bg-slate-900 border-[1.5px] border-slate-700 rounded-lg outline-none transition-all duration-200 ease-in-out shadow-sm text-center placeholder:text-slate-600 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/15"
          />
        </div>
        <div className="absolute top-0 flex flex-col items-center justify-center shrink-0 z-20">
          <div className="flex items-center justify-center gap-3 z-10">
            <button className={`px-4 py-2 ${!bleConnected ? "bg-slate-800" : "bg-red-400"} text-white rounded-b-lg mb-1`} onClick={bleConnected ? disconnectBle : connectBle}>
              {bleConnected ? 'Disconnect' : 'Connect'}
            </button>
          </div>
          <span className={`text-center text-xs ${error != '' ? 'text-red-400' : 'text-gray-500'}`}>
            {error != '' ? error : status}
          </span>
        </div>
        <div className="w-full max-w-4xl flex-1 flex flex-col items-center justify-around px-4 sm:px-10 py-2">
          <div className="w-full flex items-center justify-between">
            <div className="flex items-center justify-start shrink-0 scale-90 sm:scale-100">
              <Joystick writeToBle={writeToBle} jid="J" />
            </div>
            <div className="flex items-center justify-end shrink-0 scale-90 sm:scale-100">
              <XYAB writeToBle={writeToBle} />
            </div>
          </div>
          <div className="w-full flex items-center justify-between px-[10dvw]">
            <div className="flex items-center justify-start shrink-0 scale-90 sm:scale-100">
              <Dpad writeToBle={writeToBle} />
            </div>
            <div className="flex items-center justify-end shrink-0 scale-90 sm:scale-100">
              <Joystick writeToBle={writeToBle} jid="I" />
            </div>
          </div>
        </div>
      </div>
    </div>
  ) : <div className="fixed inset-0 flex items-center justify-center bg-black text-gray-400">
    Rotate your device to landscape
  </div>
}

export default App
