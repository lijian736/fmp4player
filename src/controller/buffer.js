import * as debug from '../util/debug';
import Event from '../util/event';
import { appendByteArray } from '../util/utils.js';

/**
 * the buffer controller
 */
export default class BufferController extends Event {

    /**
     * constructor
     * @param {SourceBuffer} sourceBuffer 
     * @param {String} type -- 'video' or 'audio'
     */
    constructor(sourceBuffer, type) {
        super('buffer');

        this.type = type;
        this.queue = new Uint8Array();

        this.cleaning = false;
        this.pendingCleaning = 0;  //second
        this.cleanOffset = 30;   //30 seconds
        this.cleanRanges = [];  //second

        this.sourceBuffer = sourceBuffer;
        this.sourceBuffer.addEventListener('updateend', ()=> {
            if (this.pendingCleaning > 0) {
                this.initCleanup(this.pendingCleaning);
                this.pendingCleaning = 0;
            }
            this.cleaning = false;
            if (this.cleanRanges.length) {
                this.doCleanup();
            }
        });

        this.sourceBuffer.addEventListener('error', ()=> {
            this.dispatch('error', { type: this.type, name: 'buffer', error: 'buffer error' });
        });
    }

    destroy() {
        this.queue = null;
        this.sourceBuffer = null;
        this.offAll();
    }

    /**
     * do clean up the source buffer
     * @returns 
     */
    doCleanup() {
        if (!this.cleanRanges.length) {
            this.cleaning = false;
            return;
        }
        let range = this.cleanRanges.shift();
        debug.log(`${this.type} remove range [${range[0]} - ${range[1]})`);
        this.cleaning = true;
        this.sourceBuffer.remove(range[0], range[1]);
    }

    /**
     * initialize the cleanup action, the actual clean up is in doCleanup() function
     * @param {number} cleanPosition -- the clean position in seconds
     * @returns 
     */
    initCleanup(cleanPosition) {
        try {
            if (this.sourceBuffer.updating) {
                this.pendingCleaning = cleanPosition;
                return;
            }
            if (this.sourceBuffer.buffered && this.sourceBuffer.buffered.length && !this.cleaning) {
                for (let i = 0; i < this.sourceBuffer.buffered.length; ++i) {
                    let start = this.sourceBuffer.buffered.start(i);
                    let end = this.sourceBuffer.buffered.end(i);

                    debug.log(`start:${start}, end:${end}, cleanposition:${cleanPosition}`);

                    if ((cleanPosition - start) > this.cleanOffset) {
                        end = cleanPosition - this.cleanOffset;
                        if (start < end) {
                            this.cleanRanges.push([start, end]);
                        }
                    }
                }
                this.doCleanup();
            }
        } catch (e) {
            debug.error(`Error occured while cleaning ${this.type} buffer - ${e.name}: ${e.message}`);
        }
    }

    /**
     * append the track data to MSE's source buffer
     * @returns 
     */
    doAppend() {
        if (!this.queue.length) return;

        if (!this.sourceBuffer || this.sourceBuffer.updating) return;

        try {
            this.sourceBuffer.appendBuffer(this.queue);
            this.queue = new Uint8Array();
        } catch (e) {
            let name = 'unexpectedError';
            if (e.name === 'QuotaExceededError') {
                debug.log(`${this.type} buffer quota full`);
                name = 'QuotaExceeded';
            } else {
                debug.error(`Error occured while appending ${this.type} buffer - ${e.name}: ${e.message}`);
                name = 'InvalidStateError';
            }
            this.dispatch('error', { type: this.type, name: name, error: 'buffer error' });
        }
    }

    /**
     * feed data to buffer
     * @param {Uint8Array} data -- Uint8Array the FMP4 box
     */
    feed(data) {
        this.queue = appendByteArray(this.queue, data);
    }
}
