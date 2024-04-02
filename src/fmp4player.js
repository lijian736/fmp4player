import * as debug from './util/debug';
import { NALU } from './util/nalu.js';
import { appendByteArray } from './util/utils.js';
import { H264Parser } from './parsers/h264.js';
import { AACParser } from './parsers/aac.js';
import Event from './util/event';
import RemuxController from './controller/remux.js';
import BufferController from './controller/buffer.js';

/**
 * the Fragment MP4 player
 */
export default class FMP4Player extends Event {

    /**
     * check if the browser supports MSE and websocket
     * @returns 
     */
    static isEnvironmentOK(){
        window.MediaSource = window.MediaSource || window.WebKitMediaSource;
        if (!window.MediaSource) {
            return false;
        }

        if (!!window.WebSocket && window.WebSocket.prototype.send) {
            return true;
        }

        return false;
    }

    /**
     * check if the browser supports Media Source Extensions and the specified codec
     * @param {string} codec the codec
     * @returns 
     */
    static isSupported(codec) {
        return (window.MediaSource && window.MediaSource.isTypeSupported(codec));
    }

    /**
     * the constructor
     * @param {object} options the constructor options
     * the options format is:
     * {
     *     node: '',             //the <video/> element id
     *     mode: 'both',         //the play mode, 'video','audio' or 'both'
     *     debug: false,         //if the FMP4Player runs in debug mode
     *     flushingBufferTime: 0,      //the flushing time in milliseconds
     *     videoTagMaxDelay: 500,        //the max delay in milliseconds
     *     autoClearSourceBuffer: false,    // auto clear the source buffer or not
     *     fps: 30,              //the fps
     *     readFpsFromTrack: false,  //if the fps is extract from track
     *     onReady: function,        // the ready callback when MSE is ready
     *     onError: function,        //the error callback when the FMP4Player encounters any buffer related error
     * }
     */
    constructor(options) {
        super('FMP4Player');
        this.isReset = false;
        let defaults = {
            node: '',      //the <video/> element id
            mode: 'both',  // play mode, both, audio or video
            debug: false,  // if the player runs in debug mode
            flushingBufferTime: 1500,   //flushing buffer time in milliseconds
            videoTagMaxDelay: 10000,        //the max delay in milliseconds
            autoClearSourceBuffer: true,    //auto clear the source buffer or not
            fps: 30,              //the fps
            readFpsFromTrack: false,   // defaults to false to keep existing functionality
            onReady: function () {},   // function called when MSE is ready to accept frames
            onError: function () {},   // function called when FMP4Player encounters any buffer related error
        };
        this.options = Object.assign({}, defaults, options);

        //check the run environment, node.js or browser
        this.env = (typeof process === 'object' && typeof window === 'undefined') ? 'node' : 'browser';
        if (this.env == 'node') {
            throw 'Please run the player in browsers.';
        }

        //if the player run in debug mode, enable the logger
        if (this.options.debug) {
            debug.setLogger();
        }

        //the default fps
        if (!this.options.fps) {
            this.options.fps = 30;
        }

        //each frame duration
        this.frameDuration = (1000 / this.options.fps) | 0;
        //the remux controller
        this.remuxController = new RemuxController();
        //the remux controller track mode, 'both', 'video' or 'audio'
        this.remuxController.addTrack(this.options.mode);

        //initialize the data
        this.initData();

        //the fmp4 fragments buffer callback
        //the 'buffer' event was triggered
        this.remuxController.on('buffer', this.onBuffer.bind(this));

        //the AAC header parsed and(!!!) the H.264 SPS and PPS parsed
        //the 'ready' event was triggered.
        this.remuxController.on('ready', this.createBuffer.bind(this));

        //initialize the browser
        this.initBrowser();
    }

    /**
     * initialize the data
     */
    initData() {
        //the last clean time
        this.lastCleaningTime = Date.now();
        //the key frame position, elapsed time in seconds since the play starts
        this.keyFramePosition = [];
        //the key frame counter
        this.keyFrameCounter = 0;
        //the H.264 pending units object, it's duration is 0
        //the format is:
        //{ units:[NALU1, NALU2, ...], keyFrame: bool, vcl: bool}
        this.pendingUnits = {};
        //start the timer
        this.startInterval();
    }

    /**
     * initialize the browser
     */
    initBrowser() {
        if (typeof this.options.node === 'string' && this.options.node == '') {
            debug.error('no video element were found to render, provide a valid video element');
        }

        //the <video/> element node
        this.node = typeof this.options.node === 'string' ? document.getElementById(this.options.node) : this.options.node;

        //the MSE ready
        this.mseReady = false;
        //set up the mse
        this.setupMSE();
    }

    /**
     * set up the MSE
     */
    setupMSE() {
        //the pc media source and mobile media source
        window.MediaSource = window.MediaSource || window.WebKitMediaSource;
        if (!window.MediaSource) {
            throw 'the Browser does NOT support media source extension.';
        }
        //transform the media source to boolean
        this.isMSESupported = !!window.MediaSource;
        //create the media source object
        this.mediaSource = new MediaSource();
        this.url = URL.createObjectURL(this.mediaSource);
        this.node.src = this.url;
        //mse end?
        this.mseEnded = false;

        //add source open listener
        this.mediaSource.addEventListener('sourceopen', this.onMSEOpen.bind(this));
        //add source close listener
        this.mediaSource.addEventListener('sourceclose', this.onMSEClose.bind(this));
        //add source open listener
        this.mediaSource.addEventListener('webkitsourceopen', this.onMSEOpen.bind(this));
        //add source close listener
        this.mediaSource.addEventListener('webkitsourceclose', this.onMSEClose.bind(this));
    }

    /**
     * end the mse
     */
    endMSE() {
        if (!this.mseEnded) {
            try {
                this.mseEnded = true;
                this.mediaSource.endOfStream();
            } catch (e) {
                debug.error('mediasource is not able to end');
            }
        }
    }

    /**
     * feed data to MSE
     * @param {object} data -- the duration and audio/video data
     * the data format is:
     * {
     *    audio: audio (Uint8Array),
     *    video: video (Uint8Array),
     *    duration_aac: AAC duration(milliseconds)
     *    duration_h264: H.264 duration(milliseconds)
     * };
     * 
     * @returns 
     */
    feed(data) {
        let remux = false,
            slices,
            aacDuration,
            h264Duration,
            chunks = {
                video: [],
                audio: []
            };

        if (!data || !this.remuxController) return;

        aacDuration = data.duration_aac ? Number.parseInt(data.duration_aac) : 0;
        h264Duration = data.duration_h264 ? Number.parseInt(data.duration_h264) : 0;

        if (data.video && data.video.byteLength > 0) {
            slices = H264Parser.extractNALU(data.video);
            if (slices.length > 0) {
                chunks.video = this.getVideoFrames(slices, h264Duration);
                remux = true;
            } else {
                debug.error('Failed to extract any NAL units from video data');
                return;
            }
        }
        if (data.audio && data.audio.byteLength > 0) {
            slices = AACParser.extractAAC(data.audio);
            if (slices.length > 0) {
                chunks.audio = this.getAudioFrames(slices, aacDuration);
                remux = true;
            } else {
                debug.error('Failed to extract audio data from:', data.audio);
                return;
            }
        }
        if (!remux) {
            debug.error('Input object must have video and/or audio property. Make sure it is a valid typed array');
            return;
        }
        this.remuxController.remux(chunks);
    }

    /**
     * get H.264 video frames from array
     * @param {Array} nalus -- the NALU array, the NALU NOT contains start code, it's Uint8Array byte
     * @param {number} duration -- the duration in milliseconds
     * @returns Array, format is:
     * [
     *  { units: [NALU1, NALU2, ....], duration: duration of units, keyFrame: whether units contains IDR frame },
     *  {},
     *  {}
     * ]
     * 
     * the duration of each frame in @param nalus is NOT exact.
     */
    getVideoFrames(nalus, duration) {
        let units = [],
            frames = [],
            fd = 0,
            tt = 0,
            keyFrame = false,
            vcl = false;

        if (this.pendingUnits.units) {
            units = this.pendingUnits.units;
            vcl = this.pendingUnits.vcl;
            keyFrame = this.pendingUnits.keyFrame;
            this.pendingUnits = {};
        }

        for (let nalu of nalus) {
            let unit = new NALU(nalu);
            //if it's I, P or B frame
            if (unit.type() === NALU.IDR || unit.type() === NALU.NDR) {
                H264Parser.parseHeader(unit);
            }
            if (units.length && vcl && (unit.isfmb || !unit.isvcl)) {
                frames.push({
                    units,
                    keyFrame  //is it contains an IDR frame?
                });
                units = [];
                keyFrame = false;
                vcl = false;
            }
            units.push(unit);
            //is it an IDR frame?
            keyFrame = keyFrame || unit.isKeyframe();
            //is it an I|P|B|IDR frame?
            vcl = vcl || unit.isvcl;
        }
        if (units.length) {
            // lets keep indecisive nalus as pending in case of fixed fps
            if (!duration) {
                this.pendingUnits = {
                    units,
                    keyFrame,
                    vcl
                };
            } else if (vcl) {
                frames.push({
                    units,
                    keyFrame
                });
            } else {
                let last = frames.length - 1;
                if (last >= 0) {
                    frames[last].units = frames[last].units.concat(units);
                }
            }
        }
        fd = duration ? duration / frames.length | 0 : this.frameDuration;
        tt = duration ? (duration - (fd * frames.length)) : 0;

        frames.map((frame) => {
            frame.duration = fd;
            if (tt > 0) {
                frame.duration++;
                tt--;
            }
            this.keyFrameCounter++;
            if (frame.keyFrame && this.options.autoClearSourceBuffer) {
                this.keyFramePosition.push((this.keyFrameCounter * fd) / 1000);
            }
        });
        //debug.log(`FMP4Player: the last chunk has ${frames.length} frames, total duration:${duration}`);
        return frames;
    }

    /**
     * get AAC frames from array
     * @param {Array} aacFrames -- the AAC raw data frame(Uint8Array) array,  NOT contains the ADTS header
     * @param {number} duration -- the duration in milliseconds
     * @returns Array, format is:
     * [ 
     *   { uints: Uint8Array, duration: duration/aacFrames.length}, 
     *   {}, 
     *   {},
     * ]
     * 
     * the duration of each frame in @param aacFrames is duration/aacFrames.length,
     * it is NOT exact.
     */
    getAudioFrames(aacFrames, duration) {
        let frames = [],
            fd = 0,
            tt = 0;

        for (let units of aacFrames) {
            frames.push({
                units
            });
        }
        fd = duration ? duration / frames.length | 0 : this.frameDuration;
        tt = duration ? (duration - (fd * frames.length)) : 0;
        frames.map((frame) => {
            frame.duration = fd;
            if (tt > 0) {
                frame.duration++;
                tt--;
            }
        });
        return frames;
    }

    destroy() {
        this.stopInterval();
        if (this.remuxController) {
            this.remuxController.destroy();
            this.remuxController = null;
        }
        if (this.bufferControllers) {
            for (let type in this.bufferControllers) {
                this.bufferControllers[type].destroy();
            }
            this.bufferControllers = null;
            this.endMSE();
        }
        this.node = false;
        this.mseReady = false;
        this.videoStarted = false;
        this.mediaSource = null;
    }

    /**
     * reset the player when source buffer errors occur
     */
    reset() {
        this.stopInterval();
        this.isReset = true;
        //pause the play
        this.node.pause();
        if (this.remuxController) {
            this.remuxController.reset();
        }
        if (this.bufferControllers) {
            for (let type in this.bufferControllers) {
                this.bufferControllers[type].destroy();
            }
            this.bufferControllers = null;
            this.endMSE();
        }
        this.initData();
        this.initBrowser();

        debug.log('FMP4Player was reset');
    }

    /**
     * create the media source's source buffer
     * this function was invoked when the H.264 SPS & PPS parsed and
     * AAC ADTS header parsed.
     * @returns 
     */
    createBuffer() {
        //mseReady: MediaSource is ready(open event happens)
        if (!this.mseReady || !this.remuxController || !this.remuxController.isReady() || this.bufferControllers) return;
        
        this.bufferControllers = {};
        for (let type in this.remuxController.tracks) {
            let track = this.remuxController.tracks[type];
            if (!FMP4Player.isSupported(`${type}/mp4; codecs="${track.mp4track.codec}"`)) {
                debug.error('Browser does not support codec');
                return false;
            }
            let sb = this.mediaSource.addSourceBuffer(`${type}/mp4; codecs="${track.mp4track.codec}"`);
            this.bufferControllers[type] = new BufferController(sb, type);
            this.bufferControllers[type].on('error', this.onBufferError.bind(this));
        }
    }

    /**
     * start the timer
     */
    startInterval() {
        this.interval = setInterval(() => {
            if (this.options.flushingBufferTime) {
                this.applyAndClearBuffer();
            } else if (this.bufferControllers) {
                this.cancelVideoTagDelay();
            }
        }, this.options.flushingBufferTime || 1000);
    }

    /**
     * cancel the timer
     */
    stopInterval() {
        if (this.interval) {
            clearInterval(this.interval);
        }
    }

    /**
     * if the <video/> buffered data exceeds the videoTagMaxDelay limit value,
     * cance the buffered data by setting the <video/> currentTime
     */
    cancelVideoTagDelay() {
        //if the <video/> has buffered data and is not seeking
        if (this.node.buffered && this.node.buffered.length > 0 && !this.node.seeking) {
            //the first buffered data end time, in seconds
            const end = this.node.buffered.end(0);
            //currentTime is double float value in seconds
            if (end - this.node.currentTime > (this.options.videoTagMaxDelay / 1000)) {
                debug.log('=========== clean <video/> tag delay');
                //go to the buffered end
                this.node.currentTime = end - 0.001;
            }
        }
    }

    /**
     * release the buffer, append the buffer data to media source buffer
     */
    releaseBuffer() {
        for (let type in this.bufferControllers) {
            this.bufferControllers[type].doAppend();
        }
    }

    /**
     * append the data to media source buffers and
     * clear the buffer
     */
    applyAndClearBuffer() {
        if (this.bufferControllers) {
            this.releaseBuffer();
            this.clearSourceBuffer();
        }
    }

    /**
     * get the safe key frame positions, and remove key frame positions which are less than the offset
     * @param {Number} offset 
     * @returns the key frame position which will be removed
     */
    getSafeClearOffsetOfBuffer(offset) {
        let maxLimit = (this.options.mode === 'audio' && offset) || 0,
            adjacentOffset;
        for (let i = 0; i < this.keyFramePosition.length; i++) {
            if (this.keyFramePosition[i] >= offset) {
                break;
            }
            adjacentOffset = this.keyFramePosition[i];
        }
        if (adjacentOffset) {
            this.keyFramePosition = this.keyFramePosition.filter(kfDelimiter => {
                if (kfDelimiter < adjacentOffset) {
                    maxLimit = kfDelimiter;
                }
                return kfDelimiter >= adjacentOffset;
            });
        }
        return maxLimit;
    }

    /**
     * clear the source buffer
     */
    clearSourceBuffer() {
        //Date.now() returns the number of milliseconds elapsed since January 1, 1970 00:00:00 UTC
        if (this.options.autoClearSourceBuffer && (Date.now() - this.lastCleaningTime) > 10000) {
            for (let type in this.bufferControllers) {
                let cleanPosition = this.getSafeClearOffsetOfBuffer(this.node.currentTime);
                this.bufferControllers[type].initCleanup(cleanPosition);
            }
            this.lastCleaningTime = Date.now();
        }
    }

    /**
     * append fmp4 to source buffer
     * @param {object} data -- the fragment mp4 data moov box and others
     * the format is:
     * {
     *    type: 'video' or 'audio',
     *    payload: MP4 segment,
     *    fps: fps, //only for 'video'
     *    dts: dts value
     * };
     */
    onBuffer(data) {
        if (this.options.readFpsFromTrack && typeof data.fps !== 'undefined' && this.options.fps != data.fps) {
            this.options.fps = data.fps;
            this.frameDuration = Math.ceil(1000 / data.fps);
            debug.log(`FMP4Player changed FPS to ${data.fps} from track data`);
        }

        if (this.bufferControllers && this.bufferControllers[data.type]) {
            this.bufferControllers[data.type].feed(data.payload);
        }

        if (this.options.flushingBufferTime === 0) {
            this.applyAndClearBuffer();
        }
    }

    /**
     * Events on MSE
     */
    onMSEOpen() {
        this.mseReady = true;
        //free the url
        URL.revokeObjectURL(this.url);
        if (typeof this.options.onReady === 'function') {
            this.options.onReady.call(null, this.isReset);
        }
    }

    /**
     * Events on MSE
     */
    onMSEClose() {
        this.mseReady = false;
        this.videoStarted = false;
    }

    /**
     * Events on Source Buffer error
     * @param {object} data 
     * format:{ type: 'video' or 'audio', name: error name, error: 'buffer error' }
     * 
     * @returns 
     */
    onBufferError(data) {
        debug.error('===========onBufferError');
        if (data.name == 'QuotaExceeded') {
            debug.log(`FMP4Player cleaning ${data.type} buffer due to QuotaExceeded error`);
            this.bufferControllers[data.type].initCleanup(this.node.currentTime);
            return;
        } else if (data.name == 'InvalidStateError') {
            debug.log('FMP4Player is reseting due to InvalidStateError');
            this.reset();
        } else {
            debug.log('FMP4Player source buffer errors');
            this.endMSE();
        }

        //send the error to application error callback
        if (typeof this.options.onError === 'function') {
            this.options.onError.call(null, data);
        }
    }
}