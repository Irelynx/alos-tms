import fs from "fs/promises";
import { createWriteStream } from "fs";
import path from "path";
import { PNG } from 'pngjs3';
import * as GeoTIFF from "geotiff";
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const utils = require("./utils");
const JSZIP = require('jszip');
// const georaster = require("georaster/src");

const datasetPath = './dataset';
const outputPNGPath = './png';
const emptyDataFileName = 'empty.png';

const defaultMask = 0b11;
const defaultHeight = 0;
const heightMultiplier = 1; // (height + offset) * multiplier
const heightOffset = 0; // meters, int16
const reverseMask = false;

function log(...args) {
    console.log(new Date().toISOString(), ...args);
}

function reverseBits(u) {
    return parseInt(('00000000' + u.toString(2)).slice(-8).split('').reverse().join(''), 2);
}

/*
Takes in a flattened one dimensional array
representing two-dimensional pixel values
and returns an array of arrays.
*/
function unflatten(valuesInOneDimension, size) {
    const {height, width} = size;
    const valuesInTwoDimensions = [];
    for (let y = 0; y < height; y++) {
        const start = y * width;
        const end = start + width;
        valuesInTwoDimensions.push(valuesInOneDimension.slice(start, end));
    }
    return valuesInTwoDimensions;
}

/** @param {Array<Uint8Array | Uint16Array | Int8Array | Int16Array | Uint32Array | Int32Array | Float32Array | Float64Array>} arr2d */
function getStats(arr2d, noDataValue=null) {
    /** @type {number[]} */
    const maxs = [];
    /** @type {number[]} */
    const mins = [];
    const ranges = [];
    for (let sampleIndex = 0; sampleIndex < arr2d.length; sampleIndex++) {
        const sample = arr2d[sampleIndex];
        let min;
        let max;
        for (let rowIndex = 0; rowIndex < arr2d.length; rowIndex++) {
            const row = sample[rowIndex];
            for (let columnIndex = 0; columnIndex < row.length; columnIndex++) {
                const value = row[columnIndex];
                if (value !== noDataValue && !isNaN(value)) {
                    if (value < min || min === undefined) { min = value; }
                    if (value > max || max === undefined) { max = value; }
                }
            }
        }
        maxs.push(max);
        mins.push(min);
        ranges.push(max - min);
    }
    return { maxs, mins, ranges };
}

async function getGeoTiff(buf, { noDataValue=null, disableStats=false }) {
    const header = await GeoTIFF.fromArrayBuffer(
        buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
    );
    const image = await header.getImage();
    const resolutions = image.getResolution();
    const origin = image.getOrigin();
    const rasters = await image.readRasters();
    const values = rasters.map(raster => unflatten(raster, {
        height: image.fileDirectory.ImageLength,
        width: image.fileDirectory.ImageWidth
    }));
    const noDataVal = image.fileDirectory.GDAL_NODATA ? parseFloat(image.fileDirectory.GDAL_NODATA) : noDataValue;
    const stats = disableStats ? getStats(values, noDataVal) : null;
    return {
        /** @type {number} */
        projection: image.geoKeys.ProjectedCSTypeGeoKey || image.geoKeys.GeographicTypeGeoKey,
        /** @type {number} */
        width: image.fileDirectory.ImageWidth,
        /** @type {number} */
        height: image.fileDirectory.ImageLength,
        pixelWidth: Math.abs(resolutions[0]),
        pixelHeight: Math.abs(resolutions[1]),
        xmin: origin[0],
        xmax: origin[0] + image.fileDirectory.ImageWidth * Math.abs(resolutions[0]),
        ymin: origin[1] - image.fileDirectory.ImageLength * Math.abs(resolutions[1]),
        ymax: origin[1],
        bounds: {
            west: origin[0],
            east: origin[0] + image.fileDirectory.ImageWidth * Math.abs(resolutions[0]),
            south: origin[1] - image.fileDirectory.ImageLength * Math.abs(resolutions[1]),
            north: origin[1],
        },
        /** @type {number | null} */
        noDataValue: noDataVal,
        /** @type {number} */
        samples: image.fileDirectory.SamplesPerPixel,
        // palette: image.fileDirectory.ColorMap ? getPalete(image) : null, // from geotiff-palette
        values,
        stats,
        raw: {
            header,
            image,
        },
    };
}

const maskDatasets = {
    [0b00000000]: 'AW3D',
    [0b00000100]: 'GSI DTM',
    [0b00001000]: 'SRTM-1 v3',
    [0b00001100]: 'PRISM DSM',
    [0b00010000]: 'GSI ViewFinder Panoramas DEM',
    [0b00011000]: 'ASTER GDEM v2',
    [0b00011100]: 'ArcticDEM v2',
    [0b00100000]: 'TanDEM-X 90m DEM',
    [0b00100100]: 'ArcticDEM v3',
    [0b00101000]: 'ASTER GDEM v3',
    [0b00101100]: 'REMA v1.1',
    [0b11111100]: 'IDW (gdal_fillnodata)',
};

function parseMaskValue(value) {
    /*
     * Mask information for ALOS DSM v3.2 (Jan 20222).
     * Lower 1-2 bit: Valid/Invalid, Mask Information (Cloud and snow, Land water and low correlation, Sea)
     * Lower 3-8 bit: Elevation dataset used for the void-filling processing, filled/not filled by IDW method*3
     * Details of the mask:
     *  000000 00 (0x00): Valid
     *  000000 01 (0x01): Cloud and snow mask (invalid)
     *  000000 10 (0x02): Land water and low correlation mask*4 (valid)
     *  000000 11 (0x03): Sea mask*5 (valid)
     *  000001 00 (0x04): GSI DTM*6 (valid)
     *  000010 00 (0x08): SRTM-1 v3*7 (valid)
     *  000011 00 (0x08): PRISM DSM (valid)
     *  000100 00 (0x10): ViewFinder Panoramas DEM*8 (valid)
     *  000110 00 (0x18): ASTER GDEM v2*9 (valid)
     *  000111 00 (0x1C): ArcticDEM v2*10 (valid)
     *  001000 00 (0x20): TanDEM-X 90m DEM*11 (valid)
     *  001001 00 (0x24): ArcticDEM v3*10 (valid)
     *  001010 00 (0x28): ASTER GDEM v3*9 (valid)
     *  001011 00 (0x2C): REMA v1.1*12 (valid)
     *  111111 00 (0xFC): applied IDW method (gdal_fillnodata) (valid)
     */
    return {
        valid: (value & 0b11) !== 0b01,
        landWater: (value & 0b11) === 0b10,
        lowCorrelation: (value & 0b11) === 0b10,
        sea: (value & 0b11) === 0b11,
        dataset: maskDatasets[value & 0b11111100] || 'unknown',
    };
}

// max height is 8848, min height is -11034 (under-water) or -3500 (on land)

export async function loadDSMAndMSK(filePath) {
    const file = await fs.readFile(filePath).catch(e => e);
    if (file instanceof Error) return { geo: null, mask: null }; // not found, aka water-level
    const zip = await JSZIP.loadAsync(file);

    const geotiffPath = Object.keys(zip.files).filter(name => name.endsWith('DSM.tif'))[0];
    const maskPath = Object.keys(zip.files).filter(name => name.endsWith('MSK.tif'))[0];
    // parseGeoTiff(geo);
    const geo = await getGeoTiff(await zip.file(geotiffPath).async('nodebuffer'), { noDataValue: -9999 });
    const mask = await getGeoTiff(await zip.file(maskPath).async('nodebuffer'), { noDataValue: -9999 });
    
    return { geo, mask };
}

/**
 * @param {Object} obj
 * @param {number} obj.lat
 * @param {number} obj.lon
 */
export async function getHeightByLatLon({ lat, lon }) {
    const nsewString = utils.toNSEWString({ lat, lon });
    const nsewRegion = utils.getRegion({ lat, lon });
    const filePath = path.join(datasetPath, nsewString + '.zip');
    log(`reading ${nsewString}..`);
    /*
    const file = await fs.readFile(filePath).catch(e => e);
    if (file instanceof Error) return 0; // not found, aka water-level
    const zip = await JSZIP.loadAsync(file);

    const geotiffPath = Object.keys(zip.files).filter(name => name.endsWith('DSM.tif'))[0];
    const geoBuffer = await zip.file(geotiffPath).async('nodebuffer');
    const maskPath = Object.keys(zip.files).filter(name => name.endsWith('MSK.tif'))[0];
    const maskBuffer = await zip.file(maskPath).async('nodebuffer');
    // parseGeoTiff(geo);
    const geo = await getGeoTiff(geoBuffer, { noDataValue: -9999 });
    const mask = await getGeoTiff(maskBuffer, { noDataValue: -9999 });
    */
    const { geo, mask } = await loadDSMAndMSK(filePath);
    if (!geo) {
        log(`Done. Height data not found!`);
        return {
            height: 0,
            mask: seaMock.red,
            bounds: null,
        };
    }
    const posy = Math.floor((geo.bounds.north - lat) / geo.pixelHeight);
    const posx = Math.floor((lon - geo.bounds.west) / geo.pixelWidth);
    const bounds = {
        west: geo.bounds.west + posx * geo.pixelWidth,
        east: geo.bounds.west + (posx + 1) * geo.pixelWidth,
        south: geo.bounds.south + posy * geo.pixelHeight,
        north: geo.bounds.south + (posy + 1) * geo.pixelHeight,
    };
    log(`Done. 
    Region bounds (lat, lon) = ${geo.bounds.south}..${geo.bounds.north}, ${geo.bounds.east}..${geo.bounds.west}
    Returning height for x,y = ${posx},${posy}`);
    return {
        height: geo.values[0][posy][posx],
        mask: mask.values[0][posy][posx],
        bounds,
    };
}

/**
 * @param {ReadableStream | WritableStream} stream
 * @returns {Promise<void>}
 */
function streamClose(stream) {
    return new Promise((resolve, reject) => {
        stream.on('close', resolve);
        stream.on('error', reject);
    });
}

let emptyDataCreated = false;
export async function generatePNGForEntireChunk({ lat, lon }) {
    const nsewString = utils.toNSEWString({ lat, lon });
    const nsewRegion = utils.getRegion({ lat, lon });
    const filePath = path.join(datasetPath, nsewString + '.zip');
    log(`reading ${nsewString}..`);
    const { geo, mask } = await loadDSMAndMSK(filePath);
    const targetWidth = 3600;
    const targetHeight = 3600;
    const seaMock = {
        red: defaultMask,
        green: defaultHeight & 0x00ff,
        blue: (defaultHeight & 0xff00) >> 8
    };
    log(`Creating PNG instance`);
    const png = new PNG({
        width: targetWidth,
        height: targetHeight,
        colorType: 2, // RGB only
        inputColorType: 2, // RGB only
        bitDepth: 8, // 1 Byte per channel
        inputHasAlpha: 3, // no alpha
        bgColor: seaMock,
        deflateLevel: 9,
    });
    if (!geo) {
        log(`No data found for ${nsewString}. Mocking with mask=${defaultMask} and height=${defaultHeight}`);
        if (emptyDataCreated) return; // skip
        let idx = 0;
        for (let px = 0; px < targetHeight * targetWidth; px++) {
            png.data[idx++] = seaMock.red;
            png.data[idx++] = seaMock.green;
            png.data[idx++] = seaMock.blue;
        }
        log(`fill done`);
        emptyDataCreated = true;
    } else {
        // for cases where geo.width !== targetWidth or geo.height !== targetHeight
        const xMult = geo.width / targetWidth;
        const yMult = geo.height / targetHeight;
        log(`filling PNG with data.. x/y multipliers: ${xMult}/${yMult}`);
        for (let y = 0; y < targetHeight; y++) {
            const dy = Math.floor(y * yMult);
            for (let x = 0; x < targetWidth; x++) {
                const idx = (targetWidth * y + x) * 3;
                const dx = Math.floor(x * xMult);
                png.data.writeUInt8(reverseMask ? reverseBits(mask.values[0][dy][dx]) : mask.values[0][dy][dx], idx);
                png.data.writeInt16LE((geo.values[0][dy][dx] + heightOffset) * heightMultiplier, idx + 1);
            }
        }
        log(`fill done`);
    }
    
    const outputFileName = geo
        ? path.join(outputPNGPath, `${nsewString}.png`)
        : path.join(outputPNGPath, emptyDataFileName);
    log(`saving to ${outputFileName}..`);
    await fs.mkdir(outputPNGPath, { recursive: true });
    const outputFileStream = createWriteStream(outputFileName);
    png.pack().pipe(outputFileStream);
    // stream.pipe(outputFile);
    await streamClose(outputFileStream);
    log(`done`);
}


async function main(args) {
    console.log(await getHeightByLatLon({
        lat: 39.474332,
        lon: -1.034603,
    }));
}

async function main1() {
    await generatePNGForEntireChunk({
        lat: 59, lon: 30,
        //lat: 39.469860, lon: -0.371647,
    });
}

async function main2(args) {
    const minLat = -90;
    const maxLat = 90;
    const minLon = -180;
    const maxLon = 180;
    const stepLat = 1;
    const stepLon = 1;
    const totalChunks = (maxLat - minLat) / stepLat * (maxLon - minLon) / stepLon;
    const startChunk = 56590;
    let chunk = 0;
    for (let lon = minLon; lon < maxLon; lon += stepLon) {
        for (let lat = minLat; lat < maxLat; lat += stepLat) {
            chunk++;
            if (chunk < startChunk) continue;
            log(`${chunk}/${totalChunks}\t${(chunk / totalChunks * 100).toFixed(2)}%\t${lat},${lon}`);
            await generatePNGForEntireChunk({ lat, lon });
        }
    }
}

// main2(process.argv.slice(2));

export default {
    loadDSMAndMSK,
    getHeightByLatLon,
    generatePNGForEntireChunk,
};
