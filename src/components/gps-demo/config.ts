import { ARROW_TURN_THRESHOLD_DEG } from './core/gpsInterval'

/**
 * auto        — detect walking/running/cycling from ground speed (core/motion.ts)
 *               and pick the strategy below automatically: walk/run use 'save'
 *               (with a temporary performance burst through corners), bike uses
 *               'performance' always. Default.
 * performance — continuous watchPosition, maximumGPS rate. Best accuracy.
 * save        — adaptive polling via getCurrentPosition. GPS rate 1–10 s based on
 *               turn sharpness and speed. Significantly reduces GPS radio usage.
 */
export type GpsMode = 'auto' | 'performance' | 'save'

export interface NavConfig {
  /** Distance (m) from route before the "Off Route" warning triggers. */
  offRouteThresholdM: number
  /**
   * @deprecated No longer used for navigation. Off-route rejoin now aims at a
   * fixed metre distance ahead (REJOIN_LOOKAHEAD_M in navigation.ts) so the aim
   * is stable regardless of route density. Kept only so older persisted configs
   * still deserialize. Safe to remove after a storage-key bump.
   */
  lookahead: number
  /** Minimum GPS movement (m) required before a new bearing is computed.
   *  Prevents jitter when standing still. */
  jitterThresholdM: number
  /** Bearing change (degrees) required to treat a point as a turn waypoint.
   *  Takes effect on the next GPX file load. */
  turnThresholdDeg: number
  /** GPS polling strategy. 'save' uses adaptive intervals to reduce battery drain. */
  gpsMode: GpsMode
  /** Metres before a geometric corner when the arrow starts blending toward the turn. */
  turnAnticipationStartM: number
  /** Vibrate (native) / shake the arrow (desktop) before upcoming turns. */
  turnVibration: boolean
  /**
   * Maximum arrow rotation speed (degrees per second). Caps how fast the
   * directional arrow slews toward a new target so a large correction sweeps
   * smoothly instead of snapping — gentle on a physical watch motor and reads
   * as "premium". Small corrections are unaffected. Lower = calmer.
   */
  arrowMaxDegPerSec: number
  /**
   * Battery-save long-straight poll cap (ms). On a long straight far from any
   * corner the GPS poll interval extends up to this value (dead-reckoning glides
   * the display between the sparse confirm-fixes). Higher = more battery saved
   * but slower to notice you've wandered off a long straight. A look-ahead clamp
   * keeps every corner fully polled at any value, so this is safe to tune freely.
   */
  straightIntervalMs: number
  /**
   * Arrow-angle deviation (degrees) beyond which GPS polling stays fast (1 s)
   * until the arrow settles back under this threshold. Independent of the
   * route-geometry corner cooldown — this reacts to the live arrow reading
   * directly, so it also covers off-route wandering or an unusual turn.
   * Lower = fast polling engages (and stays engaged) more readily; higher =
   * more battery saved but slower to react to a turn the arrow is still
   * showing.
   */
  arrowTurnThresholdDeg: number
}

export const DEFAULT_NAV_CONFIG: NavConfig = {
  offRouteThresholdM: 20,
  lookahead: 3,
  jitterThresholdM: 3.0,
  turnThresholdDeg: 10,
  gpsMode: 'auto',
  turnAnticipationStartM: 100,
  turnVibration: true,
  arrowMaxDegPerSec: 120,
  straightIntervalMs: 12000,
  arrowTurnThresholdDeg: ARROW_TURN_THRESHOLD_DEG,
}

// v12: pure-pursuit redesign — dropped rejoinCorridorM (single off-route threshold now)
const STORAGE_KEY = 'gps-nav-config-v12'

export function loadConfig(): NavConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_NAV_CONFIG }
    const parsed = JSON.parse(raw) as Partial<NavConfig>
    return { ...DEFAULT_NAV_CONFIG, ...parsed }
  } catch {
    return { ...DEFAULT_NAV_CONFIG }
  }
}

export function saveConfig(config: NavConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
  } catch {
    // Ignore storage errors (private mode / quota exceeded)
  }
}
