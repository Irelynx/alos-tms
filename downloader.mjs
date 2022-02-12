import "dotenv/config";
import fs from "fs/promises";
import path from "path";
import fetch from "node-fetch";
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const utils = require("./utils");

const AUTH = `Basic ${Buffer.from(`${process.env.USER}:${process.env.PASSWORD}`).toString('base64')}`;
const outputPath = './dataset';
const metaPath = './meta.json';
// const regions = utils.parseRegions(
//     ['N080W030_N090E000', 'N080E000_N090E030', 'N080E030_N090E060', 'N080E060_N090E090', 'N080E090_N090E120', 'N080W120_N090W090', 'N080W090_N090W060', 'N080W060_N090W030', 'N050W030_N080E000', 'N050E000_N080E030', 'N050E030_N080E060', 'N050E060_N080E090', 'N050E090_N080E120', 'N050E120_N080E150', 'N050E150_N080E180', 'N050W180_N080W150', 'N050W150_N080W120', 'N050W120_N080W090', 'N050W090_N080W060', 'N050W060_N080W030', 'N020W030_N050E000', 'N020E000_N050E030', 'N020E030_N050E060', 'N020E060_N050E090', 'N020E090_N050E120', 'N020E120_N050E150', 'N020E150_N050E180', 'N020W180_N050W150', 'N020W150_N050W120', 'N020W120_N050W090', 'N020W090_N050W060', 'N020W060_N050W030', 'S010W030_N020E000', 'S010E000_N020E030', 'S010E030_N020E060', 'S010E060_N020E090', 'S010E090_N020E120', 'S010E120_N020E150', 'S010E150_N020E180', 'S010W180_N020W150', 'S010W150_N020W120', 'S010W120_N020W090', 'S010W090_N020W060', 'S010W060_N020W030', 'S040W030_S010E000', 'S040E000_S010E030', 'S040E030_S010E060', 'S040E060_S010E090', 'S040E090_S010E120', 'S040E120_S010E150', 'S040E150_S010E180', 'S040W180_S010W150', 'S040W150_S010W120', 'S040W120_S010W090', 'S040W090_S010W060', 'S040W060_S010W030', 'S070W030_S040E000', 'S070E000_S040E030', 'S070E030_S040E060', 'S070E060_S040E090', 'S070E090_S040E120', 'S070E120_S040E150', 'S070E150_S040E180', 'S070W180_S040W150', 'S070W120_S040W090', 'S070W090_S040W060', 'S070W060_S040W030', 'S090W030_S070E000', 'S090E000_S070E030', 'S090E030_S070E060', 'S090E060_S070E090', 'S090E090_S070E120', 'S090E120_S070E150', 'S090E150_S070E180', 'S090W180_S070W150', 'S090W150_S070W120', 'S090W120_S070W090', 'S090W090_S070W060', 'S090W060_S070W030']
// );
// const regionSectorSize = 5; // degrees
const baseURL = 'https://www.eorc.jaxa.jp/ALOS/aw3d30/data/release_v2012/{region}/{nsewString}.zip';
// const baseURL = 'http://192.168.40.5:8081?remote=https://www.eorc.jaxa.jp/ALOS/aw3d30/data/release_v2012/{region}/{nsewString}.zip';
// https://www.eorc.jaxa.jp/ALOS/aw3d30/data/release_v2012/N055E030/N059E030.zip
let meta = {};

async function loadMeta() {
    try {
        meta = JSON.parse(await fs.readFile(metaPath));
    } catch(e) {
        meta = {};
    }
}

async function saveMeta() {
    await fs.writeFile(metaPath, JSON.stringify(meta));
}

// /** @param {{ lat: number, lon: number }} param0 */
// function getALOSRegion({ lat, lon }) {
//     for (const region of regions) {
//         if (
//             region.minLat <= lat && lat < region.maxLat
//             && region.minLon <= lon && lon < region.maxLon
//         ) {
//             return region;
//         }
//     }
//     return null;
// }

function log(...args) {
    console.log(new Date().toISOString(), ...args);
}

function getETag(nsewString) {
    return meta?.etags?.[nsewString];
}

async function saveETag(nsewString, etag) {
    if (!meta.etags) meta.etags = {};
    meta.etags[nsewString] = etag;
    await saveMeta();
}

function getState(nsewString) {
    return meta?.states?.[nsewString];
}

async function saveState(nsewString, state) {
    if (!meta.states) meta.states = {};
    meta.states[nsewString] = state;
    await saveMeta();
}

/** @param {{ lat: number, lon: number }} param0 */
export async function downloadTile({ lat, lon }) {
    const nsewString = utils.toNSEWString({ lat, lon });
    const state = getState(nsewString);
    if (state) return;
    const outputFilePath = path.join(outputPath, `${nsewString}.zip`);
    const _buf = await fs.readFile(outputFilePath).catch(e => null)
    if (_buf && _buf.slice(0, 2).toString() === 'PK') {
        await saveState(nsewString, 200);
        return true;
    }
    // const region = getALOSRegion({ lat, lon }).region;
    const region = utils.getRegion({ lat, lon });
    const targetURL = utils.prepareURL(baseURL, { nsewString, region });
    const options = {
        headers: {
            'Authorization': AUTH,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9',
            // 'Referer': `https://www.eorc.jaxa.jp/ALOS/en/aw3d30/data/html_v2012/dl/download_v2012.htm?${region}`
        },
        redirect: 'manual',
    };
    log(`fetching ${nsewString} from ${region} region..`);
    let response;
    try {
        response = await fetch(targetURL, options);
    } catch (e) {
        log(e.name);
        if (e.message?.includes('ETIMEDOUT')) {
            // connection timeout
            await saveState(nsewString, 504);
            return false;
        }
    }
    
    const etag = response.headers.get('ETag');
    const contentType = response.headers.get('Content-Type');
    const contentLength = response.headers.get('Content-Length');
    if (contentType !== 'application/zip') {
        if (response.status === 302 || response.url.includes('ALOS/url_change_info.htm')) {
            await saveState(nsewString, 404);
            return false;
        }
        log({ url: response.url, etag, contentType, contentLength });
        // possible redirect from "Not Found" to https://www.eorc.jaxa.jp/ALOS/url_change_info.htm
        throw new Error('Content-Type is not application/zip');
    }
    
    if (getETag(nsewString) === etag) {
        log(`${nsewString} in cache (etag: ${etag})`);
    };
    
    log(`downloading ${contentLength} bytes of ${nsewString}..`);
    const body = await response.arrayBuffer();
    log(`downloading ${contentLength} bytes of ${nsewString} - done`);

    await fs.writeFile(outputFilePath, Buffer.from(body));
    await saveState(nsewString, 200);
    await saveETag(nsewString, etag);
    return true;
}

async function downloadAllTiles(args) {
    await fs.mkdir(outputPath, { recursive: true });
    await loadMeta();
    const minLat = -85;
    const maxLat = 85;
    const minLon = -180;
    const maxLon = 180;
    let activeDownloads = 0;
    const maxSimultaneousDownloads = 4;
    for (let lon = minLon; lon <= maxLon; lon++) {
        for (let lat = minLat; lat <= maxLat; lat++) {
            while (activeDownloads >= maxSimultaneousDownloads) await utils.sleep(50);
            activeDownloads++;
            downloadTile({ lat, lon }).then(() => {
                activeDownloads--;
            });
        }
    }
}

// downloadAllTiles(process.argv.slice(2));

export default {
    downloadTile,
    downloadAllTiles,
};