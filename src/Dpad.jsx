import React from 'react';
import { BiLeftArrow, BiRightArrow, BiUpArrow, BiDownArrow } from "react-icons/bi";

// All sizes in px. Tweak these to resize; everything else is derived.
const SIZE = 186;    // outer circle (was ~156)
const BORDER = 4;    // must match border-4 below
const BTN = 62;      // button diameter (was 44)
const OFFSET = 48;   // distance from center to each button's center
const ICON = "w-8 h-8";

const C = (SIZE - 2 * BORDER) / 2; // center of the circle's inner area
const pos = (dx, dy) => ({
  width: BTN,
  height: BTN,
  left: C - BTN / 2 + dx,
  top: C - BTN / 2 + dy,
});

const btn =
  "absolute rounded-full bg-gray-500 border-2 border-gray-600 flex items-center justify-center touch-none";
const icon = `${ICON} text-gray-600 pointer-events-none`;

const Dpad = ({ writeToBle }) => {
  return (
    <div className="inline-block">
      <div
        className="relative bg-radial from-black to-gray-800 rounded-full border-4 border-gray-700 z-20 select-none touch-none"
        style={{ width: SIZE, height: SIZE }}
      >
        <button data-ble="DU" className={btn} style={pos(0, -OFFSET)}>
          <BiUpArrow className={icon} />
        </button>
        <button data-ble="DL" className={btn} style={pos(-OFFSET, 0)}>
          <BiLeftArrow className={icon} />
        </button>
        <button data-ble="DR" className={btn} style={pos(OFFSET, 0)}>
          <BiRightArrow className={icon} />
        </button>
        <button data-ble="DD" className={btn} style={pos(0, OFFSET)}>
          <BiDownArrow className={icon} />
        </button>
      </div>
    </div>
  );
};

export default Dpad;