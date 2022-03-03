/** @param {Array<string>} regions */
function parseRegions(regions) {
    const out = [];
    for (const name of regions) {
        const [ l, r ] = name.split('_').map(fromNSEWString);

        const region = {
            region: name,
            minLat: l.lat,
            minLon: l.lon,
            maxLat: r.lat,
            maxLon: r.lon,
        };
        out.push(region);
    }
    return out;
}

/** @param {{ lat: number, lon: number }} param0 */
function toNSEWString({ lat, lon }) {
    const NS = lat < 0 ? 'S' : 'N';
    const EW = lon < 0 ? 'W' : 'E';
    lat = Math.floor(lat);
    lon = Math.floor(lon);
    const rLat = NS === 'S' ? -lat : lat;
    const rLon = EW === 'W' ? -lon : lon;
    const nsewString = `${NS}${('000' + rLat).slice(-3)}${EW}${('000' + rLon).slice(-3)}`;
    return nsewString;
}

/** @param {string} str */
function fromNSEWString(str) {
    const NS = str.slice(0, 1);
    const EW = str.slice(4, 5);
    const rLat = parseInt(str.slice(1, 4));
    const rLon = parseInt(str.slice(5, 8));
    return {
        lat: NS === 'S' ? -rLat : rLat,
        lon: EW === 'W' ? -rLon : rLon,
    }
}

/**
 * @param {{ lat: number, lon: number }} param0
 */
function getRegion({ lat, lon }, regionSectorSize=5) {
    // -85,-180 == S85W180 .. S80W175
    // -81,-176 == S85W180 .. S80W175
    // 81,-176 == N80W180 .. N85W175
    const nsv = Math.floor(lat / regionSectorSize) * regionSectorSize;
    const ewv = Math.floor(lon / regionSectorSize) * regionSectorSize;
    return toNSEWString({ lat: nsv, lon: ewv });
}

/**
 * @param {string} urlTemplate 
 * @param {{[key: string]: string | number | boolean}} object 
 * @returns {string}
 */
function prepareURL(urlTemplate, object) {
    const keys = Object.keys(object);
    for (const key of keys) {
        urlTemplate = urlTemplate.split(`{${key}}`).join(object[key]);
    }
    return urlTemplate;
}

/**
 * asynchronous sleep (usage: `await sleep(time)`)
 * @param {number} time_ms
 * @returns {Promise<void>}
 */
function sleep(time_ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, time_ms);
    });
}

/**
 * Takes in a flattened one dimensional array
 * representing two-dimensional pixel values
 * and returns an array of arrays.
 * @param {Array<any>} valuesInOneDimension
 * @param {Object} size
 * @param {number} size.height
 * @param {number} size.width
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

if (module) {
    module.exports = {
        sleep,
        prepareURL,
        getRegion,
        fromNSEWString,
        toNSEWString,
        parseRegions,
        unflatten,
    };
}