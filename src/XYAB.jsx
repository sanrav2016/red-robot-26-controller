import React from 'react'

const XYAB = ({ writeToBle }) => {
  return (
    <div className="flex flex-col justify-center items-center text-white font-bold text-3xl">
      <button data-ble="BY" className="w-14 h-14 bg-gradient-to-r from-yellow-400 to-yellow-600 rounded-full flex items-center justify-center">
        Y
      </button>
      <div className="flex justify-center items-center gap-16 w-full">
        <button data-ble="BX" className="w-14 h-14 bg-gradient-to-r from-blue-400 to-blue-600 rounded-full flex items-center justify-center">
          X
        </button>
        <button data-ble="BB" className="w-14 h-14 bg-gradient-to-r from-red-400 to-red-600 rounded-full flex items-center justify-center">
          B
        </button>
      </div>
      <button data-ble="BA" className="w-14 h-14 bg-gradient-to-r from-green-400 to-green-600 rounded-full flex items-center justify-center">
        A
      </button>
    </div>
  )
}

export default XYAB