// A car body's outline, shared by the physics (collision box, the points that touch the ground)
// and the drawing (the skin's panels). Metres, car frame: z forward, y up from the ground under a
// resting car, x to the left. The body is symmetric left to right.
export interface BodyShape {
  /** nose and tail, from the middle (tail given as a positive distance) */
  front: number
  rear: number
  /** half width at the doors */
  hw: number
  /** sill height */
  bottom: number
  /** windscreen base (end of the hood), roof's front and back edges, where the rear glass meets the deck */
  ws: number
  roofFront: number
  roofBack: number
  glassEnd: number
  /** heights: roof, beltline at the windscreen, the nose, the rear deck, the tail */
  roofH: number
  beltWs: number
  noseH: number
  deckH: number
  tailH: number
  /** half width of the roof */
  roofHalf: number
  /** measured outlines, [z, y] (or [z, half width]) from nose to tail: where given they replace the generic curves */
  profile?: { top: [number, number][]; belt: [number, number][]; bottom: [number, number][]; width: [number, number][] }
  /** wheel-arch openings in the sides: centre z and height, radius */
  arches?: { z: number; y: number; r: number }[]
  /** bumper bars standing out beyond the nose and tail */
  bumper?: number
  /** which details to draw (lights, grille, door lines) */
  style?: 'pinto'
}

export const STREET_SHAPE: BodyShape = {
  front: 2.2, rear: 2.2, hw: 0.9, bottom: 0.24,
  ws: 0.85, roofFront: 0.2, roofBack: -0.9, glassEnd: -1.55,
  roofH: 1.36, beltWs: 0.9, noseH: 0.72, deckH: 0.98, tailH: 0.84, roofHalf: 0.7,
}

/**
 * A 1974-76 Ford Pinto two-door: 94.0 in wheelbase, about 169 in long over its 5 mph bumpers, 69.4 in
 * wide, 50 in tall. The outlines follow its side view: a long low hood dropping at the nose, a raked
 * screen, a short roof, a long shallow fastback window down to a short flat deck, and a flat tail.
 */
export const PINTO_SHAPE: BodyShape = {
  front: 2.05, rear: 2.05, hw: 0.875, bottom: 0.22,
  ws: 0.48, roofFront: -0.08, roofBack: -0.8, glassEnd: -1.48,
  roofH: 1.27, beltWs: 0.83, noseH: 0.66, deckH: 0.94, tailH: 0.89, roofHalf: 0.62,
  profile: {
    top: [[2.05, 0.7], [1.97, 0.79], [1.6, 0.83], [1.0, 0.865], [0.48, 0.885], [0.3, 0.99], [0.1, 1.13], [-0.08, 1.245], [-0.3, 1.27], [-0.55, 1.27], [-0.8, 1.245], [-1.05, 1.15], [-1.3, 1.04], [-1.48, 0.97], [-1.7, 0.95], [-1.92, 0.94], [-2.05, 0.89]],
    belt: [[2.05, 0.66], [1.85, 0.75], [1.5, 0.79], [0.48, 0.83], [-0.2, 0.85], [-0.8, 0.875], [-1.3, 0.9], [-1.48, 0.92], [-1.92, 0.92], [-2.05, 0.86]],
    bottom: [[2.05, 0.4], [1.8, 0.27], [1.45, 0.22], [-1.45, 0.22], [-1.8, 0.27], [-2.05, 0.4]],
    width: [[2.05, 0.76], [1.85, 0.85], [1.5, 0.875], [-1.5, 0.875], [-1.85, 0.85], [-2.05, 0.78]],
  },
  arches: [{ z: 1.17, y: 0.3, r: 0.37 }, { z: -1.22, y: 0.3, r: 0.37 }],
  bumper: 0.1,
  style: 'pinto',
}
