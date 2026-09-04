/**
 * Gate M.0E — WorldArtProfile separates geography from appearance.
 */
import * as THREE from 'three';
import type { LandcoverKind } from './types';

export interface TerrainArt {
  low: THREE.Color;
  mid: THREE.Color;
  high: THREE.Color;
  rock: THREE.Color;
  slopeRockDeg: number;
}

export interface LandcoverArt {
  tint: THREE.Color;
  strength: number;
}

export interface WaterArt {
  fill: number;
  opacity: number;
  roughness: number;
  metalness?: number;
}

export interface RoadArt {
  asphalt: number;
  gravel: number;
  path: number;
}

export interface BuildingArt {
  wallPalette: number[];
  roofPalette: number[];
}

export interface VegetationArt {
  conifer: number;
  deciduous: number;
  mixed: number;
}

export interface AtmosphereArt {
  fogEnabled: boolean;
}

export interface WorldArtProfile {
  id: string;
  terrain: TerrainArt;
  landcover: Partial<Record<LandcoverKind, LandcoverArt>>;
  water: WaterArt;
  roads: RoadArt;
  buildings: BuildingArt;
  vegetation: VegetationArt;
  atmosphere: AtmosphereArt;
}

/** v2 Living World nordic-parchment — illustrated miniature, not photoreal. */
const NORDIC_PARCHMENT: WorldArtProfile = {
  id: 'nordic-parchment',
  terrain: {
    low: new THREE.Color(0x8fa56a),
    mid: new THREE.Color(0x8fa56a),
    high: new THREE.Color(0xb8ad9c),
    rock: new THREE.Color(0xb8ad9c),
    slopeRockDeg: 42,
  },
  landcover: {
    farmland: { tint: new THREE.Color(0xc6b17a), strength: 0.92 },
    meadow: { tint: new THREE.Color(0xb4c07a), strength: 0.88 },
    grass: { tint: new THREE.Color(0x8fa56a), strength: 0.86 },
    heath: { tint: new THREE.Color(0x8b8460), strength: 0.9 },
    scrub: { tint: new THREE.Color(0x8b8460), strength: 0.88 },
    moor: { tint: new THREE.Color(0x8b8460), strength: 0.9 },
    wetland: { tint: new THREE.Color(0x6e8b86), strength: 0.92 },
    bare_rock: { tint: new THREE.Color(0xb8ad9c), strength: 0.9 },
    scree: { tint: new THREE.Color(0xb8ad9c), strength: 0.88 },
    sand: { tint: new THREE.Color(0xdcc9a4), strength: 0.9 },
    residential: { tint: new THREE.Color(0xc4b79e), strength: 0.18 },
    industrial: { tint: new THREE.Color(0xb2aa91), strength: 0.16 },
    quarry: { tint: new THREE.Color(0xc4b79e), strength: 0.28 },
    orchard: { tint: new THREE.Color(0xa1ad7f), strength: 0.32 },
    cemetery: { tint: new THREE.Color(0x8a9a74), strength: 0.22 },
    pitch: { tint: new THREE.Color(0x8a9a74), strength: 0.2 },
    unknown: { tint: new THREE.Color(0x8a9a72), strength: 0.12 },
  },
  water: { fill: 0xb8c9d8, opacity: 1, roughness: 0.45 },
  roads: { asphalt: 0xe8c070, gravel: 0xc19e60, path: 0xffe8b3 },
  buildings: {
    wallPalette: [0x8f6a4e, 0x7f5f45, 0x866848, 0x846248, 0x7a5a40],
    roofPalette: [0xf0d8b6, 0xe7c575, 0xdcc4a8],
  },
  vegetation: { conifer: 0x3b4938, deciduous: 0x7e936c, mixed: 0x718267 },
  atmosphere: { fogEnabled: false },
};

const ORIGIN_BALANCED: WorldArtProfile = {
  id: 'origin-balanced',
  terrain: {
    low: new THREE.Color(0x8fa56a),
    mid: new THREE.Color(0x8fa56a),
    high: new THREE.Color(0xb8ad9c),
    rock: new THREE.Color(0xb8ad9c),
    slopeRockDeg: 42,
  },
  landcover: {
    farmland: { tint: new THREE.Color(0xc6b17a), strength: 0.92 },
    meadow: { tint: new THREE.Color(0xb4c07a), strength: 0.88 },
    grass: { tint: new THREE.Color(0x8fa56a), strength: 0.86 },
    heath: { tint: new THREE.Color(0x8b8460), strength: 0.9 },
    scrub: { tint: new THREE.Color(0x8b8460), strength: 0.88 },
    moor: { tint: new THREE.Color(0x8b8460), strength: 0.9 },
    wetland: { tint: new THREE.Color(0x6e8b86), strength: 0.92 },
    bare_rock: { tint: new THREE.Color(0xb8ad9c), strength: 0.9 },
    scree: { tint: new THREE.Color(0xb8ad9c), strength: 0.88 },
    sand: { tint: new THREE.Color(0xdcc9a4), strength: 0.9 },
    residential: { tint: new THREE.Color(0xa8a090), strength: 0.1 },
    industrial: { tint: new THREE.Color(0x989890), strength: 0.12 },
    quarry: { tint: new THREE.Color(0xb0a088), strength: 0.18 },
    orchard: { tint: new THREE.Color(0x98b060), strength: 0.16 },
    cemetery: { tint: new THREE.Color(0x88a068), strength: 0.12 },
    pitch: { tint: new THREE.Color(0x6a9868), strength: 0.14 },
    unknown: { tint: new THREE.Color(0x909080), strength: 0.08 },
  },
  water: { fill: 0x3a6d8c, opacity: 0.88, roughness: 0.35 },
  roads: { asphalt: 0x4a4a4a, gravel: 0x6a6458, path: 0x8a8068 },
  buildings: {
    wallPalette: [0xc9ba9e, 0xd4c6ab, 0xbba98c, 0xe0d3b8, 0xc2b194, 0xd8cbb0],
    roofPalette: [0x6e5a48, 0x7a6350, 0x5c4a3c, 0x8a7160, 0x4f4036],
  },
  vegetation: { conifer: 0x3d5c3a, deciduous: 0x4a7048, mixed: 0x456644 },
  atmosphere: { fogEnabled: false },
};

const profiles = new Map<string, WorldArtProfile>([
  ['origin-balanced', ORIGIN_BALANCED],
  ['nordic-parchment', NORDIC_PARCHMENT],
  ['parchment', NORDIC_PARCHMENT],
]);

export function getArtProfile(id = 'origin-balanced'): WorldArtProfile {
  return profiles.get(id) ?? ORIGIN_BALANCED;
}

export function registerArtProfile(profile: WorldArtProfile) {
  profiles.set(profile.id, profile);
}
