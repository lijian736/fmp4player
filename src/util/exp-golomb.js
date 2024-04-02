/**
 * Parser for exponential Golomb codes, a variable-bitwidth number encoding scheme used by H.264.
 * @see https://www.jianshu.com/p/a31621affd40
*/

export class ExpGolomb {

    /**
     * constructor
     * @param {*} data -- the byte ArrayBuffer
     */
    constructor(data) {
        //the bytes ArrayBuffer
        this.data = data;
        //the current index in bits
        this.index = 0;
        //the total bits length
        this.bitLength = data.byteLength * 8;
    }

    setData(data) {
        this.data = data;
        this.index = 0;
        this.bitLength = data.byteLength * 8;
    }

    /**
     * if bits are available in ArrayBuffer
     */
    get bitsAvailable() {
        return this.bitLength - this.index;
    }

    /**
     * skip bits
     * @param {*} size -- the bits count
     * @returns 
     */
    skipBits(size) {
        if (this.bitsAvailable < size) {
            return false;
        }
        this.index += size;
    }

    /**
     * read bits
     * @param {*} size -- the bits count to read
     * @param {*} moveIndex -- if move the current index position
     * @returns the bits count actually read from the ArrayBuffer
     */
    readBits(size, moveIndex = true) {
        const result = this.getBits(size, this.index, moveIndex);
        return result;
    }

    /**
     * get bits 
     * @param {*} size -- the bits count to read
     * @param {*} offsetBits -- the offset position in buffer
     * @param {*} moveIndex -- if move the current offset position
     * @returns 
     */
    getBits(size, offsetBits, moveIndex = true) {
        if (this.bitsAvailable < size) {
            return 0;
        }
        const offset = offsetBits % 8;
        const byte = this.data[(offsetBits / 8) | 0] & (0xff >>> offset);
        const bits = 8 - offset;
        if (bits >= size) {
            if (moveIndex) {
                this.index += size;
            }
            return byte >> (bits - size);
        } else {
            if (moveIndex) {
                this.index += bits;
            }
            const nextSize = size - bits;
            return (byte << nextSize) | this.getBits(nextSize, offsetBits + bits, moveIndex);
        }
    }

    /**
     * skip the leading zero bit
     * @returns the skipped leading zero bit count
     */
    skipLZ() {
        let leadingZeroCount;
        for (leadingZeroCount = 0; leadingZeroCount < this.bitLength - this.index; ++leadingZeroCount) {
            if (this.getBits(1, this.index + leadingZeroCount, false) !== 0) {
                this.index += leadingZeroCount;
                return leadingZeroCount;
            }
        }
        return leadingZeroCount;
    }

    skipUEG() {
        this.skipBits(1 + this.skipLZ());
    }

    skipEG() {
        this.skipBits(1 + this.skipLZ());
    }

    readUEG() {
        const prefix = this.skipLZ();
        return this.readBits(prefix + 1) - 1;
    }

    readEG() {
        const value = this.readUEG();
        if (0x01 & value) {
            // the number is odd if the low order bit is set
            return (1 + value) >>> 1; // add 1 to make it even, and divide by 2
        } else {
            return -1 * (value >>> 1); // divide by two then make it negative
        }
    }

    /**
     * read 1 bit as boolean
     * @returns 
     */
    readBoolean() {
        return this.readBits(1) === 1;
    }

    /**
     * read unsigned bytes
     * @param {*} numberOfBytes -- the bytes number to read
     * @returns 
     */
    readUByte(numberOfBytes = 1) {
        return this.readBits((numberOfBytes * 8));
    }

    /**
     * read unsigned short (16 bits)
     * @returns 
     */
    readUShort() {
        return this.readBits(16);
    }

    /**
     * return unsigned int (32 bits)
     * @returns 
     */
    readUInt() {
        return this.readBits(32);
    }
}

