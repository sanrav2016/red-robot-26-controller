import React, { useState, useRef, useContext } from 'react';
import { RotationContext } from './rotation';

export default function Joystick({ jid, writeToBle }) {
  const [position, setPosition] = useState({ x: 50, y: 50 });
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef(null);
  const rot = useContext(RotationContext);
  const lastPosRef = useRef({ x: 50, y: 50 });
  const lastTimeRef = useRef(Date.now());
  const lastSentTimeRef = useRef(0);

  const handlePointerDown = (e) => {
    setIsDragging(true);
    e.target.setPointerCapture(e.pointerId);
    updateJoystickPosition(e);
  };

  const handlePointerMove = (e) => {
    if (!isDragging) return;
    updateJoystickPosition(e);
  };

  const updateJoystickPosition = (e) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();

    // Pointer offset from the joystick centre, in screen space.
    let ox = e.clientX - (rect.left + rect.width / 2);
    let oy = e.clientY - (rect.top + rect.height / 2);
    // Convert to the joystick's own (rotated) axes.
    if (rot === 90) [ox, oy] = [oy, -ox];
    else if (rot === -90) [ox, oy] = [-oy, ox];

    let x = 50 + (ox / rect.width) * 100;
    let y = 50 + (oy / rect.height) * 100;

    x = Math.max(0, Math.min(100, x));
    y = Math.max(0, Math.min(100, y));

    setPosition({ x, y });

    // transform to range -100 to 100
    let transformed_x = Math.round((x - 50) * 2);
    let transformed_y = Math.round((50 - y) * 2);

    // throttle based on joystick speed
    const now = Date.now();
    const dt = now - lastTimeRef.current;

    if (dt > 0) {
      const dx = x - lastPosRef.current.x;
      const dy = y - lastPosRef.current.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const speed = distance / dt;

      const minInterval = 30;
      const maxInterval = 120;

      // if moving fast, keep interval small and strict
      // if moving slow, keep interval larger and more relaxed
      const dynamicInterval = Math.min(maxInterval, minInterval + speed * 200);

      if (now - lastSentTimeRef.current >= dynamicInterval) {
          lastSentTimeRef.current = now;
          writeToBle(jid, [transformed_x, transformed_y]);
      }

      lastPosRef.current = { x, y };
      lastTimeRef.current = now;
    }
   };

  const handlePointerUp = (e) => {
    setIsDragging(false);
    if (e.target.hasPointerCapture(e.pointerId)) {
      e.target.releasePointerCapture(e.pointerId);
    }
    setPosition({ x: 50, y: 50 });
    writeToBle(jid, [0, 0]);
  };

  return (
      <div
        ref={containerRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        className="relative w-40 h-40 bg-radial from-black to-gray-800 rounded-full flex items-center justify-center border-4 border-gray-700 cursor-pointer touch-none"
      >
        <div
          style={{ top: `${position.y}%`, left: `${position.x}%` }}
          className="absolute -translate-x-1/2 -translate-y-1/2 w-16 h-16 bg-radial from-blue-300 to-pink-500 rounded-full shadow-lg pointer-events-none transition-transform duration-75"
        />
      </div>
  );
}