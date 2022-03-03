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

import {
    datasetPath,
    outputPNGPath,
    emptyDataFileName,
    defaultMask,
    defaultHeight,
    heightMultiplier,
    heightOffset,
    reverseMask,
    outputPNGLowResPath,
    lowResFactor,
    lowResAlgorithm,
    inputFullSizePNGPath,
} from "./dataset.options.mjs";

function log(...args) {
    console.log(new Date().toISOString(), ...args);
}

/** @param {number} u - positive, uint8 number */
function reverseBits(u) {
    return parseInt(('00000000' + u.toString(2)).slice(-8).split('').reverse().join(''), 2);
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
    const values = rasters.map(raster => utils.unflatten(raster, {
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

/**
 * @param {NodeJS.EventEmitter} emitter
 * @param {string} event
 * @param {string} [rejectEvent]
 */
function waitForEvent(emitter, event, rejectEvent) {
    return new Promise((resolve, reject) => {
        emitter.on(event, resolve);
        if (rejectEvent) emitter.on(rejectEvent, reject);
    });
}

/**
 * @param {...number} args
 */
function average(...args) {
    let sum = 0;
    for (let i=0; i<args.length; i++) {
        sum += args[i];
    }
    return sum / args.length;
}

let emptyDataCreated = false;
export async function generatePNGForEntireChunk({ lat, lon }) {
    const nsewString = utils.toNSEWString({ lat, lon });
    // const nsewRegion = utils.getRegion({ lat, lon });
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
        inputHasAlpha: false, // no alpha
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

/**
 * WARN: ALWAYS returns 4 channel image
 */
export async function loadPNGChunk({ lat, lon }) {
    const nsewString = utils.toNSEWString({ lat, lon });
    const filePath = path.join(inputFullSizePNGPath, nsewString + '.png');
    const input = new PNG();
    input.parse(await fs.readFile(filePath));
    await waitForEvent(input, 'parsed');
    return input;
}

export async function generateLowResPNGChunk({ lat, lon }) {
    if (lowResFactor === 1) return;
    if (lowResFactor !== 2 && lowResFactor !== 3) {
        throw new Error(`Unsupported lowResFactor: ${lowResFactor}`);
    }
    if (lowResAlgorithm !== 'average' && lowResAlgorithm !== 'center' && lowResAlgorithm !== 'max') {
        throw new Error(`Unsupported lowResAlgorithm: ${lowResAlgorithm}`);
    }
    let input;
    try {
        input = await loadPNGChunk({ lat, lon });
    } catch (e) {
        log(`Chunk not found. lat: ${lat}, lon: ${lon}`);
        log(e);
        return;
    }
    const channels = input.data.length / input.width / input.height;
    if (channels !== 3 && channels !== 4) {
        throw new Error(`Unexpected channels count for 1 Byte per channel image: ${channels}`);
    }
    const nsewString = utils.toNSEWString({ lat, lon });
    const ow = input.width / lowResFactor;
    const oh = input.height / lowResFactor;
    const seaMock = {
        red: defaultMask,
        green: defaultHeight & 0x00ff,
        blue: (defaultHeight & 0xff00) >> 8
    };
    const output = new PNG({
        width: ow,
        height: oh,
        colorType: 2, // RGB only
        inputColorType: 2, // RGB only
        bitDepth: 8, // 1 Byte per channel
        inputHasAlpha: false, // no alpha
        bgColor: seaMock,
        deflateLevel: 9,
    });

    if (lowResFactor === 2) {
        if (lowResAlgorithm === 'center')
        for (let y=0; y<oh; y++) {
            for (let x=0; x<ow; x++) {
                const r0 = (y * ow * lowResFactor + x) * lowResFactor * channels;
                const oidx = (y * ow + x) * 3;
                output.data.writeUInt8(input.data[r0], oidx);
                output.data.writeInt16LE(input.data.readInt16LE(r0 + 1), oidx + 1);
            }
        }
        if (lowResAlgorithm === 'average')
        for (let y=0; y<oh; y++) {
            for (let x=0; x<ow; x++) {
                const r0 = (y * ow * lowResFactor + x) * lowResFactor * channels;
                const r1 = (y * ow * lowResFactor + x + ow) * lowResFactor * channels;
                const oidx = (y * ow + x) * 3;
                // TODO: calculate mask properly
                output.data.writeUInt8(Math.max(
                    input.data[r0],
                    input.data[r0 + channels],
                    input.data[r1],
                    input.data[r1 + channels],
                ), oidx);
                output.data.writeInt16LE(average(
                    input.data.readInt16LE(r0 + 1),
                    input.data.readInt16LE(r0 + channels + 1),
                    input.data.readInt16LE(r1 + 1),
                    input.data.readInt16LE(r1 + channels + 1),
                ), oidx + 1);
            }
        }
        if (lowResAlgorithm === 'max')
        for (let y=0; y<oh; y++) {
            for (let x=0; x<ow; x++) {
                const r0 = (y * ow * lowResFactor + x) * lowResFactor * channels;
                const r1 = (y * ow * lowResFactor + x + ow) * lowResFactor * channels;
                const oidx = (y * ow + x) * 3;
                // TODO: calculate mask properly
                output.data.writeUInt8(Math.max(
                    input.data[r0],
                    input.data[r0 + channels],
                    input.data[r1],
                    input.data[r1 + channels],
                ), oidx);
                output.data.writeInt16LE(Math.max(
                    input.data.readInt16LE(r0 + 1),
                    input.data.readInt16LE(r0 + channels + 1),
                    input.data.readInt16LE(r1 + 1),
                    input.data.readInt16LE(r1 + channels + 1),
                ), oidx + 1);
            }
        }
    } else if (lowResFactor === 3) {
        if (lowResAlgorithm === 'center')
        for (let y=0; y<oh; y++) {
            for (let x=0; x<ow; x++) {
                const r1 = (y * ow * lowResFactor + x + ow) * lowResFactor * channels;
                const oidx = (y * ow + x) * 3;
                output.data.writeUInt8(input.data[r1 + channels], oidx);
                output.data.writeInt16LE(input.data.readInt16LE(r1 + channels + 1), oidx + 1);
            }
        }
        if (lowResAlgorithm === 'average')
        for (let y=0; y<oh; y++) {
            for (let x=0; x<ow; x++) {
                const r0 = (y * ow * lowResFactor + x) * lowResFactor * channels;
                const r1 = (y * ow * lowResFactor + x + ow) * lowResFactor * channels;
                const r2 = (y * ow * lowResFactor + x + ow * 2) * lowResFactor * channels;
                const oidx = (y * ow + x) * 3;
                output.data.writeUInt8(input.data[r1 + channels], oidx);
                output.data.writeInt16LE(average(
                    input.data.readInt16LE(r0 + 1),
                    input.data.readInt16LE(r0 + channels + 1),
                    input.data.readInt16LE(r0 + channels * 2 + 1),
                    input.data.readInt16LE(r1 + 1),
                    input.data.readInt16LE(r1 + channels + 1),
                    input.data.readInt16LE(r1 + channels * 2 + 1),
                    input.data.readInt16LE(r2 + 1),
                    input.data.readInt16LE(r2 + channels + 1),
                    input.data.readInt16LE(r2 + channels * 2 + 1),
                ), oidx + 1);
            }
        }
        if (lowResAlgorithm === 'max')
        for (let y=0; y<oh; y++) {
            for (let x=0; x<ow; x++) {
                const r0 = (y * ow * lowResFactor + x) * lowResFactor * channels;
                const r1 = (y * ow * lowResFactor + x + ow) * lowResFactor * channels;
                const r2 = (y * ow * lowResFactor + x + ow * 2) * lowResFactor * channels;
                const oidx = (y * ow + x) * 3;
                output.data.writeUInt8(input.data[r1 + channels], oidx);
                output.data.writeInt16LE(Math.max(
                    input.data.readInt16LE(r0 + 1),
                    input.data.readInt16LE(r0 + channels + 1),
                    input.data.readInt16LE(r0 + channels * 2 + 1),
                    input.data.readInt16LE(r1 + 1),
                    input.data.readInt16LE(r1 + channels + 1),
                    input.data.readInt16LE(r1 + channels * 2 + 1),
                    input.data.readInt16LE(r2 + 1),
                    input.data.readInt16LE(r2 + channels + 1),
                    input.data.readInt16LE(r2 + channels * 2 + 1),
                ), oidx + 1);
            }
        }
    }

    const outputFilePath = path.join(`${outputPNGLowResPath}_${lowResFactor}_${lowResAlgorithm}`, nsewString + '.png');
    log(`saving to ${outputFilePath}..`);
    await fs.mkdir(path.parse(outputFilePath).dir, { recursive: true });
    const outputFileStream = createWriteStream(outputFilePath);
    output.pack().pipe(outputFileStream);
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
    const startChunk = 0;
    let chunk = 0;
    for (let lon = minLon; lon < maxLon; lon += stepLon) {
        for (let lat = minLat; lat < maxLat; lat += stepLat) {
            chunk++;
            if (chunk < startChunk) continue;
            log(`${chunk}/${totalChunks}\t${(chunk / totalChunks * 100).toFixed(2)}%\t${lat},${lon}`);
            // await generatePNGForEntireChunk({ lat, lon });
            await generateLowResPNGChunk({ lat, lon });
        }
    }
}

// main2(process.argv.slice(2));

export default {
    loadDSMAndMSK,
    getHeightByLatLon,
    generatePNGForEntireChunk,
    loadPNGChunk,
};
