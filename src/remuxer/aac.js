import * as debug from '../util/debug';
import { AACParser } from '../parsers/aac.js';
import { BaseRemuxer } from './base.js';

/**
 * the AAC remuxer
 */
export class AACRemuxer extends BaseRemuxer {

    /**
     * constructor
     * @param {number} timescale -- the timescale, default value is 1000 milliseconds
     */
    constructor(timescale) {
        super();
        this.readyToDecode = false;   //ready to decode
        this.nextDts = 0;
        this.dts = 0;
        this.mp4track = {
            id: BaseRemuxer.getTrackID(),   //the track id
            type: 'audio',
            len: 0,
            fragmented: true,
            channelCount: 0,
            timescale: timescale,
            duration: timescale,   //1000 milliseconds
            samples: [],
            config: '',
            codec: '',
        };
        this.timescale = timescale;
        //the samples format is:
        //[{ units: Uint8Array, size: byteLength of units, duration: frame duration}, {}, {}]
        this.samples = [];
        this.aacParser = new AACParser(this);
    }

    /**
     * reset the AAC track
     */
    resetTrack() {
        this.readyToDecode = false;
        this.mp4track.codec = '';
        this.mp4track.channelCount = '';
        this.mp4track.config = '';
        this.mp4track.timescale = this.timescale;
        this.nextDts = 0;
        this.dts = 0;
    }

    /**
     * remux frames to samples array
     * @param {Array} frames -- the frame array,
     * the format is:
     *  [{ uints: Uint8Array, duration: duration of this frame}, {}, {}]
     */
    remux(frames) {
        for (let frame of frames) {
            let payload = frame.units;
            let size = payload.byteLength;
            this.samples.push({
                units: payload,
                size: size,
                duration: frame.duration,
            });
            this.mp4track.len += size;
            if (!this.readyToDecode) {
                this.aacParser.setAACConfig();
            }
        }
    }

    /**
     * get the track payload from samples array, and clear samples
     * @returns Uint8Array, the buffer is AAC data. the AAC data does NOT contains the ADTS header
     */
    getPayload() {
        if (!this.isReady()) {
            return null;
        }

        let payload = new Uint8Array(this.mp4track.len);
        let offset = 0;
        let mp4Samples = this.mp4track.samples;
        let mp4Sample,
            duration;

        this.dts = this.nextDts;

        while (this.samples.length) {
            let sample = this.samples.shift();

            duration = sample.duration;

            if (duration <= 0) {
                debug.log(`remuxer: invalid sample duration at DTS: ${this.nextDts} :${duration}`);
                this.mp4track.len -= sample.size;
                continue;
            }

            this.nextDts += duration;
            mp4Sample = {
                size: sample.size,  //bytes
                duration: duration,  //milliseconds
                cts: 0,
                flags: {
                    isLeading: 0,
                    isDependedOn: 0,
                    hasRedundancy: 0,
                    degradPrio: 0,
                    dependsOn: 1,
                },
            };

            payload.set(sample.units, offset);
            offset += sample.size;
            mp4Samples.push(mp4Sample);
        }

        if (!mp4Samples.length) return null;

        return new Uint8Array(payload.buffer, 0, this.mp4track.len);
    }
}
