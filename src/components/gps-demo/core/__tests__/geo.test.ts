import { describe, expect, it } from 'vitest'
import { bearing, haversineDistance, movePosition, normalizeAngle, projectOntoSegment } from '../geo'

describe('haversineDistance', () => {
  it('is zero for identical points', () => {
    expect(haversineDistance({ lat: 60.17, lng: 24.94 }, { lat: 60.17, lng: 24.94 })).toBe(0)
  })

  it('one degree of latitude is ~111.2 km', () => {
    expect(haversineDistance({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeCloseTo(111_195, -2)
  })
})

describe('bearing', () => {
  it('due north is 0°', () => {
    expect(bearing({ lat: 60, lng: 24 }, { lat: 61, lng: 24 })).toBeCloseTo(0, 1)
  })

  it('due east is ~90°', () => {
    const b = bearing({ lat: 60, lng: 24 }, { lat: 60, lng: 25 })
    expect(b).toBeGreaterThan(85)
    expect(b).toBeLessThan(95)
  })

  it('due south is 180°', () => {
    expect(bearing({ lat: 60, lng: 24 }, { lat: 59, lng: 24 })).toBeCloseTo(180, 1)
  })

  it('due west is ~270°', () => {
    const b = bearing({ lat: 60, lng: 24 }, { lat: 60, lng: 23 })
    expect(b).toBeGreaterThan(265)
    expect(b).toBeLessThan(275)
  })

  it('is always in [0, 360)', () => {
    const b = bearing({ lat: 60, lng: 24 }, { lat: 59.999, lng: 23.999 })
    expect(b).toBeGreaterThanOrEqual(0)
    expect(b).toBeLessThan(360)
  })
})

describe('normalizeAngle', () => {
  it('wraps 270 to -90', () => {
    expect(normalizeAngle(270)).toBe(-90)
  })

  it('wraps -270 to 90', () => {
    expect(normalizeAngle(-270)).toBe(90)
  })

  it('maps -180 to 180 (not -180)', () => {
    expect(normalizeAngle(-180)).toBe(180)
  })

  it('wraps 360 to 0', () => {
    expect(normalizeAngle(360)).toBe(0)
  })
})

describe('movePosition', () => {
  it('moving 0 metres returns (approximately) the same position', () => {
    const start = { lat: 60, lng: 24 }
    const moved = movePosition(start, 90, 0)
    expect(moved.lat).toBeCloseTo(start.lat, 9)
    expect(moved.lng).toBeCloseTo(start.lng, 9)
  })

  it('moving north increases latitude', () => {
    const start = { lat: 60, lng: 24 }
    const moved = movePosition(start, 0, 1000)
    expect(moved.lat).toBeGreaterThan(start.lat)
    expect(moved.lng).toBeCloseTo(start.lng, 3)
  })

  it('moving then measuring distance round-trips (haversine agrees)', () => {
    const start = { lat: 60, lng: 24 }
    const moved = movePosition(start, 45, 500)
    expect(haversineDistance(start, moved)).toBeCloseTo(500, 0)
  })

  it('the bearing to a moved point matches the bearing moved along', () => {
    const start = { lat: 60, lng: 24 }
    const moved = movePosition(start, 130, 2000)
    expect(bearing(start, moved)).toBeCloseTo(130, 0)
  })
})

describe('projectOntoSegment', () => {
  it('projects a point at the segment start to t=0', () => {
    const a = { lat: 60, lng: 24 }
    const b = { lat: 60.01, lng: 24 }
    const { t, distance } = projectOntoSegment(a, a, b)
    expect(t).toBe(0)
    expect(distance).toBeCloseTo(0, 6)
  })

  it('projects a point at the segment end to t=1', () => {
    const a = { lat: 60, lng: 24 }
    const b = { lat: 60.01, lng: 24 }
    const { t, distance } = projectOntoSegment(b, a, b)
    expect(t).toBe(1)
    expect(distance).toBeCloseTo(0, 6)
  })

  it('projects a point at the midpoint to t≈0.5', () => {
    const a = { lat: 60, lng: 24 }
    const b = { lat: 60.01, lng: 24 }
    const mid = { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 }
    const { t, distance } = projectOntoSegment(mid, a, b)
    expect(t).toBeCloseTo(0.5, 3)
    expect(distance).toBeCloseTo(0, 3)
  })

  it('clamps t to [0, 1] for a point beyond the segment', () => {
    const a = { lat: 60, lng: 24 }
    const b = { lat: 60.01, lng: 24 }
    const beyond = { lat: 60.02, lng: 24 }
    const { t } = projectOntoSegment(beyond, a, b)
    expect(t).toBe(1)
  })

  it('measures perpendicular distance off the line correctly', () => {
    const a = { lat: 60, lng: 24 }
    const b = { lat: 60.01, lng: 24 }
    const mid = { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 }
    const offsetEast = movePosition(mid, 90, 100)
    const { distance } = projectOntoSegment(offsetEast, a, b)
    expect(distance).toBeGreaterThan(95)
    expect(distance).toBeLessThan(105)
  })

  it('handles a degenerate segment (a === b) without throwing', () => {
    const a = { lat: 60, lng: 24 }
    const result = projectOntoSegment({ lat: 60.001, lng: 24.001 }, a, a)
    expect(result.t).toBe(0)
    expect(Number.isFinite(result.distance)).toBe(true)
  })

  it('an explicit cosLat produces the same result as the default computed one', () => {
    const a = { lat: 60, lng: 24 }
    const b = { lat: 60.01, lng: 24 }
    const pos = movePosition({ lat: 60.005, lng: 24 }, 90, 50)
    const withoutCosLat = projectOntoSegment(pos, a, b)
    const avgLatRad = (((a.lat + b.lat) / 2) * Math.PI) / 180
    const withCosLat = projectOntoSegment(pos, a, b, Math.cos(avgLatRad))
    expect(withCosLat.t).toBeCloseTo(withoutCosLat.t, 9)
    expect(withCosLat.distance).toBeCloseTo(withoutCosLat.distance, 6)
  })
})
