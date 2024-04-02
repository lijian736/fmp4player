
let track_id = 1;

/**
 * the super class for remuxer
 */
export class BaseRemuxer {

    /**
     * get new track id
     * @returns 
     */
    static getTrackID() {
        return track_id++;
    }

    /**
     * flush data
     */
    flush() {
        this.mp4track.len = 0;
        this.mp4track.samples = [];
    }

    /**
     * is ready for remuxer
     * @returns 
     */
    isReady() {
        if (!this.readyToDecode || !this.samples.length) return false;
        return true;
    }
}
