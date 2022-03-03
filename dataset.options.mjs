
export const datasetPath = './dataset';
export const outputPNGPath = './png';
export const emptyDataFileName = 'empty.png';

export const inputFullSizePNGPath = './png_fullsize';
export const outputPNGLowResPath = './png_low';
/** @type {1 | 2 | 3} */
export const lowResFactor = 3; // 1 - "as is", 2 - get average in 2x2 square (resolution: 1800x1800px, 2 arc-second), 3 - average in 3x3 square (resolution: 1200x1200px, 3 arc-second)
/** @type {'average' | 'center' | 'max'} */
export const lowResAlgorithm = "max"; // default is "center"

export const defaultMask = 0b11;
export const defaultHeight = 0;
// max height is 8848, min height is -11034 (under-water) or -3500 (on land)
export const heightMultiplier = 1; // (height + offset) * multiplier
export const heightOffset = 0; // meters, int16
export const reverseMask = false; // true - "red" oceans instead of black

export const maskDatasets = {
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

export function parseMaskValue(value) {
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

export default {
    datasetPath,
    outputPNGPath,
    emptyDataFileName,
    defaultMask,
    defaultHeight,
    heightMultiplier,
    heightOffset,
    reverseMask,

    maskDatasets,
    parseMaskValue
};