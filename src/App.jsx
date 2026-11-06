import { useState, useRef, useEffect } from 'react'
import './App.css'
import favicon from './assets/favicon.png'
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
        }, 600);
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

function App() {
  const deviceRef = useRef(null);
  const rxCharacteristicRef = useRef(null);
  const [bleConnected, setBleConnected] = useState(false);
  const [status, setStatus] = useState('Disconnected');
  const [error, setError] = useState('');
  const writeQueueRef = useRef([]);
  const isProcessingQueueRef = useRef(false);

  const { landscape, key } = useLandscapeKey();

  useEffect(() => {
    screen.orientation?.lock?.('landscape').catch(() => { });  // works on some platforms only
  }, []);

  // Nordic UART service (NUS) UUIDs
  const SERVICE_UUID = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
  const CHARACTERISTIC_UUID_RX = "6e400002-b5a3-f393-e0a9-e50e24dcca9e";
  const CHARACTERISTIC_UUID_TX = "6e400003-b5a3-f393-e0a9-e50e24dcca9e";

  const connectBle = async () => {
    console.log('Requesting Bluetooth device...');
    setError('');
    setStatus('Requesting device...');

    try {
      const selectedDevice = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: [SERVICE_UUID]
      });
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
      console.error('Bluetooth Error:', err);
      setError(err.message || 'Failed to connect');
      setStatus('Disconnected');
    }
  };

  const writeToBle = async (key, value) => {
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
      <div className="w-[100dvw] h-[100dvh] bg-gradient-to-l from-black to-gray-900 relative flex flex-col items-center justify-between overflow-hidden m-0 p-3 select-none touch-none">
        <div className="absolute top-0 flex flex-col items-center justify-center shrink-0 z-20 pt-1">
          <div className="flex items-center justify-center gap-3 z-10">
            <button className="ctrl-btn">⚙️</button>
            <button className="ctrl-btn" onClick={bleConnected ? disconnectBle : connectBle}>
              {bleConnected ? 'Disconnect' : 'Connect'}
            </button>
            <button className="ctrl-btn">❔</button>
          </div>
          <span className={`text-center text-xs ${(error != '' || !navigator.bluetooth) ? 'text-red-400' : 'text-gray-500'}`}>
            {!navigator.bluetooth || error.includes('Web Bluetooth API') ? <span>Error: Web Bluetooth not available. <br />Try in Bluefy app (iOS) or Chrome (Android).</span> : error != '' ? error : status}
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
          <div className="w-full flex items-center justify-between">
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
