import React from 'react';
import { BiLeftArrow, BiRightArrow, BiUpArrow, BiDownArrow } from "react-icons/bi";

const Dpad = ({ writeToBle }) => {
  return (
    <div className="inline-block">
      <div className="bg-radial from-black to-gray-800 rounded-full inline-flex flex-col items-center justify-center z-20 border-4 border-gray-700 p-2 select-none touch-none">
        <div className="flex justify-center items-center">
          <button 
            onPointerDown={() => writeToBle('DU', '1')} 
            onPointerUp={() => writeToBle('DU', '0')} 
            className="w-10 h-10 bg-gray-500 rounded-t-2xl flex items-center justify-center border-2 border-gray-600 touch-none"
          >
            <BiUpArrow className="w-6 h-6 text-gray-600 pointer-events-none" />
          </button>
        </div>
        <div className="flex justify-center items-center">
          <button 
            onPointerDown={() => writeToBle('DL', '1')} 
            onPointerUp={() => writeToBle('DL', '0')} 
            className="w-10 h-10 bg-gray-500 rounded-l-2xl flex items-center justify-center border-2 border-gray-600 touch-none"
          >
            <BiLeftArrow className="w-6 h-6 text-gray-600 pointer-events-none" />
          </button>
          <button 
            onPointerDown={() => writeToBle('DC', '1')} 
            onPointerUp={() => writeToBle('DC', '0')} 
            className="w-10 h-10 bg-gray-500 flex items-center justify-center border-2 border-gray-600 touch-none"
          ></button>
          <button 
            onPointerDown={() => writeToBle('DR', '1')} 
            onPointerUp={() => writeToBle('DR', '0')} 
            className="w-10 h-10 bg-gray-500 rounded-r-2xl flex items-center justify-center border-2 border-gray-600 touch-none"
          >
            <BiRightArrow className="w-6 h-6 text-gray-600 pointer-events-none" />
          </button>
        </div>
        <div className="flex justify-center items-center">
          <button 
            onPointerDown={() => writeToBle('DD', '1')} 
            onPointerUp={() => writeToBle('DD', '0')} 
            className="w-10 h-10 bg-gray-500 rounded-b-2xl flex items-center justify-center border-2 border-gray-600 touch-none"
          >
            <BiDownArrow className="w-6 h-6 text-gray-600 pointer-events-none" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default Dpad;