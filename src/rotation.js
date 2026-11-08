import { createContext } from 'react';

// 0 = normal, 90 / -90 = UI is rotated inside a portrait screen.
export const RotationContext = createContext(0);