/**
 * `cropUrl()` with the options of Umbraco's `GetCropUrl` (story 199): what
 * query each option writes, a named crop at another size, the focal point
 * preferred over a crop's coordinates, and the cache buster from the update
 * date. docs/rendering.md, "Crop URLs".
 */
import { describe, expect, test } from 'bun:test'
import {
  type Crop,
  cacheBusterOf,
  cropUrl,
  ImageCropperValue,
  MediaWithCrops,
  PublishedMedia,
} from '@crombolo/render'

const SRC = '/media/abc/photo.jpg'
const WIDE: Crop = { alias: 'wide', width: 1600, height: 900, coordinates: null }
const CUT: Crop = {
  alias: 'square',
  width: 400,
  height: 400,
  coordinates: { x1: 0.1, y1: 0.2, x2: 0.3, y2: 0.4 },
}
const FOCAL = { left: 0.8, top: 0.5 }
const crops = [WIDE, CUT]

/** The query `cropUrl` writes, as an object. */
const query = (request: Parameters<typeof cropUrl>[3], updated?: Date) => {
  const url = cropUrl(SRC, crops, FOCAL, request, updated)
  return url === null ? null : Object.fromEntries(new URL(url, 'http://x').searchParams)
}

describe('a crop name', () => {
  test('alone is that crop at its own size, as before', () => {
    expect(query('wide')).toEqual({ rxy: '0.8,0.5', width: '1600', height: '900' })
    expect(query('square')).toEqual({ cc: '0.1,0.2,0.3,0.4', width: '400', height: '400' })
    expect(query({ crop: 'square' })).toEqual(query('square'))
    expect(query('missing')).toBeNull()
  })

  test('with a width keeps the crop’s area and shape at that width', () => {
    expect(query({ crop: 'square', width: 200 })).toEqual({
      cc: '0.1,0.2,0.3,0.4',
      width: '200',
      height: '200',
    })
    expect(query({ crop: 'wide', width: 800 })).toEqual({
      rxy: '0.8,0.5',
      width: '800',
      height: '450',
    })
    expect(query({ crop: 'wide', width: 800, height: 100 })?.height).toBe('100')
  })

  test('useCropDimensions keeps the crop’s own size whatever size is asked', () => {
    expect(query({ crop: 'square', width: 200, useCropDimensions: true })).toMatchObject({
      width: '400',
      height: '400',
    })
  })

  test('preferFocalPoint drops the crop’s coordinates for the focal point', () => {
    expect(query({ crop: 'square', preferFocalPoint: true })).toEqual({
      rxy: '0.8,0.5',
      width: '400',
      height: '400',
    })
  })
})

describe('the other options', () => {
  test('each writes the parameter the image route reads', () => {
    expect(query({ width: 300, height: 200, mode: 'Max', format: 'WEBP', quality: 70 })).toEqual({
      rxy: '0.8,0.5',
      width: '300',
      height: '200',
      rmode: 'max',
      format: 'webp',
      quality: '70',
    })
  })

  test('ratio gives the missing side, width over height', () => {
    expect(query({ width: 1600, ratio: 16 / 9 })).toMatchObject({ width: '1600', height: '900' })
    expect(query({ height: 300, ratio: 2 })).toMatchObject({ width: '600', height: '300' })
  })

  test('an anchor applies only where there is no focal point', () => {
    const noFocal = cropUrl(SRC, crops, null, { width: 100, height: 100, anchor: 'topright' })
    expect(noFocal).toBe(`${SRC}?width=100&height=100&ranchor=topright`)
    expect(query({ width: 100, height: 100, anchor: 'top' })?.ranchor).toBeUndefined()
  })

  test('further options are appended as they are', () => {
    expect(cropUrl(SRC, [], null, { width: 10, furtherOptions: '&bgcolor=fff' })).toBe(
      `${SRC}?width=10&bgcolor=fff`,
    )
    expect(cropUrl(SRC, [], null, { furtherOptions: 'v=2' })).toBe(`${SRC}?v=2`)
  })
})

describe('the cache buster', () => {
  const updated = new Date('2026-10-30T09:00:00.000Z')

  test('comes from the update date by default, and changes when it does', () => {
    expect(query('wide', updated)?.rnd).toBe(cacheBusterOf(updated))
    expect(query('wide', new Date('2026-10-31T09:00:00.000Z'))?.rnd).not.toBe(
      cacheBusterOf(updated),
    )
    // With nothing else asked for, the file's own URL with the buster.
    expect(cropUrl(SRC, [], null, {}, updated)).toBe(`${SRC}?rnd=${cacheBusterOf(updated)}`)
  })

  test('false turns it off, a string sets it, and an unknown date writes none', () => {
    expect(query({ crop: 'wide', cacheBuster: false }, updated)?.rnd).toBeUndefined()
    expect(query({ crop: 'wide', cacheBuster: 'v7' }, updated)?.rnd).toBe('v7')
    expect(query('wide', new Date(0))?.rnd).toBeUndefined()
  })

  test('a media item uses its update date, and an Image Cropper value the one it was given', () => {
    const media = new PublishedMedia({
      key: 'k',
      id: 1,
      name: 'Photo',
      mediaTypeAlias: 'Image',
      updateDate: updated,
      properties: [
        {
          alias: 'umbracoFile',
          editorAlias: 'Umbraco.ImageCropper',
          culture: null,
          segment: null,
          value: { src: SRC, crops: [WIDE] },
        },
      ],
    })
    const buster = `rnd=${cacheBusterOf(updated)}`
    expect(media.image.cropUrl('wide')).toContain(buster)
    expect(new MediaWithCrops(media, {}).cropUrl('wide')).toContain(buster)
    expect(new ImageCropperValue({ src: SRC }, updated).cropUrl({ width: 10 })).toContain(buster)
    expect(new ImageCropperValue({ src: SRC }).cropUrl({ width: 10 })).toBe(`${SRC}?width=10`)
  })
})
