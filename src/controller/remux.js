import * as debug from '../util/debug';
import { MP4 } from '../util/mp4-generator.js';
import { AACRemuxer } from '../remuxer/aac.js';
import { H264Remuxer } from '../remuxer/h264.js';
import { appendByteArray, secToTime } from '../util/utils.js';
import Event from '../util/event';

/**
 * remux controller
 * 
 */
export default class RemuxController extends Event {

    /**
     * constructor
     */
    constructor() {
        super('remuxer');
        //initialize status
        this.initialized = false;
        //track types array, the item in the array is 'video' or 'audio'
        this.trackTypes = [];

        /**
         * tracks object
         * format:
         * {
         *     video: H264Remuxer,
         *     audio: AACRemuxer
         * }
         */
        this.tracks = {};
        //the sequence number
        this.seq = 1;
        //the timescale
        this.timescale = 1000;
        //the media duration
        this.mediaDuration = 0;
    }

    /**
     * add track to the remux
     * @param {string} type -- 'video', 'audio', or 'both'
     */
    addTrack(type) {
        if (type === 'video' || type === 'both') {
            this.tracks.video = new H264Remuxer(this.timescale);
            this.trackTypes.push('video');
        }
        if (type === 'audio' || type === 'both') {
            this.tracks.audio = new AACRemuxer(this.timescale);
            this.trackTypes.push('audio');
        }
    }

    /**
     * reset the remuxer tracks
     */
    reset() {
        for (let type of this.trackTypes) {
            this.tracks[type].resetTrack();
        }
        this.initialized = false;
    }

    destroy() {
        this.tracks = {};
        this.offAll();
    }

    /**
     * flush data to MSE
     */
    flush() {
        if (!this.initialized) {
            if (this.isReady()) {
                this.dispatch('ready');
                this.initSegment();
                this.initialized = true;
                this.flush();
            }
        } else {
            for (let type of this.trackTypes) {
                let track = this.tracks[type];
                let pay = track.getPayload();
                if (pay && pay.byteLength > 0) {
                    const moof = MP4.moof(this.seq, track.dts, track.mp4track);
                    const mdat = MP4.mdat(pay);
                    let payload = appendByteArray(moof, mdat);
                    let data = {
                        type: type,
                        payload: payload,
                        dts: track.dts
                    };
                    if (type === 'video') {
                        data.fps = track.mp4track.fps;
                    }
                    this.dispatch('buffer', data);
                    //let duration = secToTime(track.dts / this.timescale);
                    //debug.log(`put segment (${type}): dts: ${track.dts} frames: ${track.mp4track.samples.length} second: ${duration}`);
                    track.flush();
                    this.seq++;
                }
            }
        }
    }

    /**
     * initialize fmp4 segment
     */
    initSegment() {
        for (let type of this.trackTypes) {
            let track = this.tracks[type];
            let data = {
                type: type,
                payload: MP4.initSegment([track.mp4track], this.mediaDuration, this.timescale),
            };
            this.dispatch('buffer', data);
        }
        debug.log('Initial segment generated.');
    }

    /**
     * if all the remux is ready(audio remux and video remux)
     * @returns true, false
     */
    isReady() {
        for (let type of this.trackTypes) {
            if (!this.tracks[type].readyToDecode || !this.tracks[type].samples.length) return false;
        }
        return true;
    }

    /**
     * remux data
     * @param {object} data 
     * the data format is:
     * {
     *   video: [{ units: [NALU1, NALU2, ....], duration: duration of the units, keyFrame: if the units contains IDR frame }, {}, {}],
     *   audio: [{ uints: Uint8Array, duration: duration of this frame}, {}, {}]
     * };
     * 
     */
    remux(data) {
        for (let type of this.trackTypes) {
            let frames = data[type];

            /* if video is present, don't add audio until video get ready */
            //if (type === 'audio' && this.tracks.video && !this.tracks.video.readyToDecode) continue; 

            if (frames.length > 0) {
                this.tracks[type].remux(frames);
            }
        }
        this.flush();
    }
}
