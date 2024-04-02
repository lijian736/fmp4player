import * as debug from '../util/debug';
let aacHeader;

/**
 * the AAC parser, it's header is ADTS(Audio Data Transport Stream)
 * This parser requires that the AAC stream ADTS header is constant, NOT vary between differ AAC frame
 */
export class AACParser {
    /**
     * the AAC sampling map
     */
    static get samplingRateMap() {
        return [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
    }

    /**
     * the AAC header
     */
    static get AACHeaderData() {
        return aacHeader;
    }

    /**
     * get the AAC header, 7 or 9
     * @param {*} data 
     * @returns 
     */
    static getHeaderLength(data) {
        return (data[1] & 0x01 ? 7 : 9);  // without CRC 7 and with CRC 9 Refs: https://wiki.multimedia.cx/index.php?title=ADTS
    }

    /**
     * get the frame length
     * @param {*} data 
     * @returns 
     */
    static getFrameLength(data) {
        return ((data[3] & 0x03) << 11) | (data[4] << 3) | ((data[5] & 0xE0) >>> 5); // 13 bits length ref: https://wiki.multimedia.cx/index.php?title=ADTS
    }

    /**
     * if the data is AAC data
     * @param {*} data 
     * @returns 
     */
    static isAACPattern (data) {
        return data[0] === 0xff && (data[1] & 0xf0) === 0xf0 && (data[1] & 0x06) === 0x00;
    }

    /**
     * extract raw audio data from an AAC ArrayBuffer, NOT include the ADTS header
     * @param {*} buffer -- the AAC data, Uint8Array
     * @returns [], the item in the Array is the raw audio data(Uint8Array), NOT include the ADTS header
     */
    static extractAAC(buffer) {
        let i = 0,
            length = buffer.byteLength,
            result = [],
            headerLength,
            frameLength;

        if (!AACParser.isAACPattern(buffer)) {
            debug.error('Invalid ADTS audio format');
            return result;
        }
        headerLength = AACParser.getHeaderLength(buffer);
        if (!aacHeader) {
            aacHeader = buffer.subarray(0, headerLength);
        }

        while (i < length) {
            frameLength = AACParser.getFrameLength(buffer);
            result.push(buffer.subarray(headerLength, frameLength));
            buffer = buffer.slice(frameLength);
            i += frameLength;
        }
        return result;
    }

    /**
     * constructor
     * @param {AACRemuxer} remuxer
     */
    constructor(remuxer) {
        this.remuxer = remuxer;
        this.track = remuxer.mp4track;
    }

    /**
     * set the AAC config
     * @returns 
     */
    setAACConfig() {
        let profile,
            sampleIndex,
            channelCount,
            config = new Uint8Array(2),
            headerData = AACParser.AACHeaderData;

        if (!headerData) return;
            
        profile = ((headerData[2] & 0xC0) >>> 6) + 1;
        sampleIndex = ((headerData[2] & 0x3C) >>> 2);
        channelCount = ((headerData[2] & 0x01) << 2);
        channelCount |= ((headerData[3] & 0xC0) >>> 6);

        /* refer to http://wiki.multimedia.cx/index.php?title=MPEG-4_Audio#Audio_Specific_Config */
        config[0] = profile << 3;
        config[0] |= (sampleIndex & 0x0E) >> 1;
        config[1] |= (sampleIndex & 0x01) << 7;
        config[1] |= channelCount << 3;

        this.track.codec = 'mp4a.40.' + profile;
        this.track.channelCount = channelCount;
        this.track.config = config;
        this.remuxer.readyToDecode = true;
    }
}