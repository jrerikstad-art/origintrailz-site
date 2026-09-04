export type Point2 = [number, number];

export interface Building {
  id: string;
  footprint: Point2[];
  floors: number;
  seed: number;
  foundation?: 'min_footprint' | 'median_footprint';
  /** Stable geographic id when known — M.0B identity wins over footprint hash. */
  osmId?: string;
  /** OSM tags when the tile carries them — ridge/hip vs gable. */
  sourceTags?: Record<string, string>;
}

export interface Road {
  id: string;
  points: Point2[];
  width: number;
  class?: string;
}

export type Biome = 'conifer' | 'deciduous' | 'mixed';

/** Semantic vegetation region — no per-tree transforms in the chunk. */
export interface Forest {
  id: string;
  type?: string;
  polygon: Point2[];
  biome?: Biome;
  density: number;
  seed: number;
  sourceTags?: Record<string, string>;
}

/** Ground surface class — Gate L.0. Vegetation stays in Forest. */
export type LandcoverKind =
  | 'farmland'
  | 'meadow'
  | 'grass'
  | 'heath'
  | 'scrub'
  | 'moor'
  | 'wetland'
  | 'bare_rock'
  | 'scree'
  | 'sand'
  | 'residential'
  | 'industrial'
  | 'quarry'
  | 'orchard'
  | 'cemetery'
  | 'pitch'
  | 'unknown';

/**
 * Semantic ground region — no materials or colours in the chunk.
 * The renderer's art profile decides what a kind looks like.
 */
export interface Landcover {
  id: string;
  polygon: Point2[];
  kind: LandcoverKind;
  osmId?: string;
  sourceTags?: Record<string, string>;
}

export interface WaterPolygon {
  /** Shoreline / outer ring (XZ local or world). */
  outer: Point2[];
  /** Islands / inner rings — Gate WATER.TOPOLOGY. */
  holes: Point2[][];
}

export interface WaterBody {
  id: string;
  polygon: Point2[];
  /** Island holes — omitted on pre-topology tiles. */
  holes?: Point2[][];
  /** OSM-derived classification — Gate W.0 */
  kind?: string;
  /** Stable cross-tile id, e.g. osm-way-12345 */
  osmId?: string;
  sourceTags?: Record<string, string>;
  /** Filled by renderer registry — not stored in tile JSON */
  elevationM?: number;
  elevationMethod?: string;
}

/** Linear water feature — Gate W.0 */
export interface Waterway {
  id: string;
  points: Point2[];
  width: number;
  class?: string;
  osmId?: string;
  sourceTags?: Record<string, string>;
}

export interface TerrainSpec {
  grid: number;
  encoding: 'uint16';
  byteOrder?: 'little' | 'big';
  minM: number;
  maxM: number;
  uri: string;
  row0?: 'north' | 'south';
  col0?: 'west' | 'east';
}

export interface ChunkOrigin {
  crs: string;
  easting: number;
  northing: number;
  lon?: number;
  lat?: number;
  localAxes?: { x: string; z: string };
}

export interface WorldChunk {
  schema?: string;
  id: string;
  size: number;
  sizeMeters?: number;
  origin?: ChunkOrigin;
  terrain?: TerrainSpec;
  buildings: Building[];
  roads: Road[];
  forests: Forest[];
  water?: WaterBody[];
  waterways?: Waterway[];
  /** Gate L.0 — optional so pre-L.0 tiles keep loading. */
  landcover?: Landcover[];
  provenance?: Record<string, unknown>;
  versions?: {
    semanticPipeline?: string;
    terrainPipeline?: string;
    coordContract?: string;
  };
}

export interface WorldSettings {
  verticalExaggeration: number;
  treeDensity: number;
  vegetationSeed: number;
  roadSetbackM: number;
  buildingSetbackM: number;
  lodNearM: number;
  lodMidM: number;
  showTerrain: boolean;
  showBuildings: boolean;
  showRoads: boolean;
  showTrees: boolean;
  showWater: boolean;
  wireframe: boolean;
  shadows: boolean;
  dprCap: number;
  fixedWidth: number;
  fixedHeight: number;
  useFixedSize: boolean;
  staticCamera: boolean;
  debugRoadCenterlines: boolean;
  debugBuildingFootprints: boolean;
  debugBuildingSamples: boolean;
  debugChunkBoundary: boolean;
  debugLocalOrigin: boolean;
  debugLandcover: boolean;
  debugWaterW0: boolean;
  debugExclusion: boolean;
  debugTreePoints: boolean;
}

export type HeightFn = (localX: number, localZ: number, exaggeration?: number) => number;
