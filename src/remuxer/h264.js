import * as debug from '../util/debug';
import { H264Parser } from '../parsers/h264.js';
import { BaseRemuxer } from './base.js';

/**
 * the H.264 remuxer
 */
export class H264Remuxer extends BaseRemuxer {

    /**
     * constructor
     * @param {number} timescale -- the timescale
     */
    constructor(timescale) {
        super();
        this.readyToDecode = false;
        this.nextDts = 0;
        this.dts = 0;
        this.mp4track = {
            id: BaseRemuxer.getTrackID(),
            type: 'video',
            len: 0,
            fragmented: true,
            sps: '',
            pps: '',
            fps: 30,
            width: 0,
            height: 0,
            timescale: timescale,
            duration: timescale,

            //the format is:
            /*{
             *  size: sample.size,  //bytes
             *  duration: duration, //milliseconds
             *  cts: 0,
             *  flags: {
             *      isLeading: 0,
             *      isDependedOn: 0,
             *      hasRedundancy: 0,
             *      degradPrio: 0,
             *      isNonSync: sample.keyFrame ? 0 : 1,
             *      dependsOn: sample.keyFrame ? 2 : 1,
                },
            }*/
            samples: [],
            codec: ''
        };

        //the format is:
        //[{units:[nalu, nalu, ....],size: total size of nalus, keyFrame: if units contains keyFrame,duration: the units duration}, {}, {}]
        this.samples = [];
        this.h264Parser = new H264Parser(this);
    }

    /**
     * reset the H.264 track
     */
    resetTrack() {
        this.readyToDecode = false;
        this.mp4track.sps = '';
        this.mp4track.pps = '';
        this.mp4track.codec = '';
        this.nextDts = 0;
        this.dts = 0;
    }

    /**
     * remux frames to samples array
     * @param {Array} frames -- the frame array
     * the format is:
     * [{ units: [NALU1, NALU2, ....], duration: duration of the units, keyFrame: if the units contains IDR frame }, {}, {}]
     */
    remux(frames) {
        for (let frame of frames) {
            let nalus = [];
            let size = 0;
            for (let nalu of frame.units) {
                if (this.h264Parser.parseNALU(nalu)) {
                    nalus.push(nalu);
                    size += nalu.getSize();
                }
            }
            if (nalus.length > 0 && this.readyToDecode) {
                this.mp4track.len += size;
                this.samples.push({
                    units: nalus,
                    size: size,
                    keyFrame: frame.keyFrame,
                    duration: frame.duration,
                });
            }
        }
    }

    /**
     * get the track payload from samples array, and clear samples
     * @returns Uint8Array, the buffer is nalus data. format:
     * nalu length(4 bytes) | nalu data | nalu length(4 bytes) | nalu data ......
     * the nalu data does NOT contain the start code 00 00 00 01
     */
    getPayload() {
        if (!this.isReady()) {
            return null;
        }

        let payload = new Uint8Array(this.mp4track.len);
        let offset = 0;
        let mp4samples = this.mp4track.samples;
        let mp4Sample,
            duration;

        this.dts = this.nextDts;
        while (this.samples.length) {
            let sample = this.samples.shift(),
                units = sample.units;

            duration = sample.duration;
            if (duration <= 0) {
                debug.log(`remuxer: invalid sample duration at DTS: ${this.nextDts} :${duration}`);
                this.mp4track.len -= sample.size;
                continue;
            }
            this.nextDts += duration;
            mp4Sample = {
                size: sample.size,  //bytes
                duration: duration, //milliseconds
                cts: 0,
                flags: {
                    isLeading: 0,
                    isDependedOn: 0,
                    hasRedundancy: 0,
                    degradPrio: 0,
                    isNonSync: sample.keyFrame ? 0 : 1,
                    dependsOn: sample.keyFrame ? 2 : 1,
                },
            };

            for (const nalu of units) {
                payload.set(nalu.getData(), offset);
                offset += nalu.getSize();
            }
            mp4samples.push(mp4Sample);
        }

        if (!mp4samples.length) return null;

        return new Uint8Array(payload.buffer, 0, this.mp4track.len);
    }
}
