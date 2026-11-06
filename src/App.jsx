import { useState, useRef } from 'react'
import './App.css'
import favicon from './assets/favicon.png'
import Joystick from './Joystick'
import Dpad from './Dpad'
import XYAB from './XYAB'

function App() {
  const deviceRef = useRef(null);
  const rxCharacteristicRef = useRef(null);
  const [bleConnected, setBleConnected] = useState(false);
  const [status, setStatus] = useState('Disconnected');
  const [error, setError] = useState('');
  const writeQueueRef = useRef([]);
  const isProcessingQueueRef = useRef(false);

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

  return (
    <>
      <link rel="icon" type="image/png" href={favicon} />
      <div className="w-screen h-screen bg-gradient-to-l from-black to-gray-900 relative flex flex-col items-center justify-center">
        <div className="absolute top-0 left-0 w-full p-2 flex flex-col justify-center items-center gap-1">
          <div className="flex items-center justify-center gap-3 z-10">
            <button className="ctrl-btn">⚙️</button>
            <button className="ctrl-btn" onClick={bleConnected ? disconnectBle : connectBle}>
              {bleConnected ? 'Disconnect' : 'Connect'}
            </button>
            <button className="ctrl-btn">❔</button>
          </div>
          <span className={`text-center text-xs ${error != '' ? 'text-red-400' : 'text-gray-500'}`}>{error.includes('Web Bluetooth API') ? <span>Error: Web Bluetooth not available. <br />Try in Bluefy app (iOS) or Chrome (Android).</span> : error != '' ? error : status}</span>
        </div>
        <div className="flex w-full items-center gap-5 justify-between px-16">
          <div className="flex flex-1 items-center justify-start"><Joystick writeToBle={writeToBle} jid="J" /></div>
          <img src={favicon} alt="Red Robot" className="w-16 h-16 brightness-0 invert" />
          <div className="flex flex-1 items-center justify-end"><XYAB writeToBle={writeToBle} /></div>
        </div>
        <div className="flex w-full items-center gap-[20%] justify-center">
          <Dpad writeToBle={writeToBle} />
          <Joystick writeToBle={writeToBle} jid="I" />
        </div>
      </div >
    </>
  )
}

export default App
