/** 
 RFC-6184 -- RTP Payload Format for H.264 Video


 H264 NALU(network abstract layer unit)
 IDR: instantaneous decoding refresh is I frame, but I frame not must be IDR

 |0|1|2|3|4|5|6|7|
 |F|NRI|Type     |

 F: forbidden_zero_bit, must be 0
 NRI:nal_ref_idc, the importance indicator
 Type: nal_unit_type

 0x67(103) (0 11 00111) SPS               very important       type = 7
 0x68(104) (0 11 01000) PPS               very important       type = 8
 0x65(101) (0 11 00101) IDR               very important       type = 5
 0x61(97)  (0 11 00001) I(non-IDR Slice)  important            type = 1 it's not IDR
 0x41(65)  (0 10 00001) P                 important            type = 1
 0x01(1)   (0 00 00001) B                 not important        type = 1
 0x06(6)   (0 00 00110) SEI               not important        type = 6
 0x09(9)   (0 00 01001) AUD               not important        type = 9

 NAL Unit Type     Packet Type      Packet Type Name
 -------------------------------------------------------------
 0                 reserved         -
 1-23              NAL unit         Single NAL unit packet
 24                STAP-A           Single-time aggregation packet
 25                STAP-B           Single-time aggregation packet
 26                MTAP16           Multi-time aggregation packet
 27                MTAP24           Multi-time aggregation packet
 28                FU-A             Fragmentation unit
 29                FU-B             Fragmentation unit
 30-31             reserved
*/


/**
 * the NALU of H.264
 * (network abstract layer unit)
 */
export class NALU {

    static get NDR() { return 1; }
    static get IDR() { return 5; }
    static get SEI() { return 6; }
    static get SPS() { return 7; }
    static get PPS() { return 8; }
    static get AUD() { return 9; }

    /**
     * the NALU types object
     */
    static get TYPES() {
        return {
            [NALU.IDR]: 'IDR',
            [NALU.SEI]: 'SEI',
            [NALU.SPS]: 'SPS',
            [NALU.PPS]: 'PPS',
            [NALU.NDR]: 'NDR',
            [NALU.AUD]: 'AUD',
        };
    }

    /**
     * get the NALU type string
     * @param {*} nalu 
     * @returns 
     */
    static type(nalu) {
        if (nalu.ntype in NALU.TYPES) {
            return NALU.TYPES[nalu.ntype];
        } else {
            return 'UNKNOWN';
        }
    }

    /**
     * the constructor
     * @param {*} data  -- the NALU payload data, it does NOT contains the start code 00 00 00 01 
     */
    constructor(data) {
        this.payload = data;  //the NALU data does NOT contains the start code
        this.nri = (this.payload[0] & 0x60) >> 5; // nal_ref_idc
        this.ntype = this.payload[0] & 0x1f;  //the NALU type
        this.isvcl = this.ntype == 1 || this.ntype == 5;  //is video code layer(?)
        this.stype = ''; // slice_type
        this.isfmb = false; // first_mb_in_slice
    }

    toString() {
        return `${NALU.type(this)}: NRI: ${this.getNri()}`;
    }

    /**
     * get the NALU NRI
     * @returns 
     */
    getNri() {
        return this.nri;
    }

    /**
     * get the NALU type
     * @returns 
     */
    type() {
        return this.ntype;
    }

    /**
     * if the NALU is IDR frame
     * @returns 
     */
    isKeyframe() {
        return this.ntype === NALU.IDR;
    }
    
    /**
     * get the NALU payload data
     * @returns 
     */
    getPayload() {
        return this.payload;
    }

    /**
     * get the payload data length
     * @returns 
     */
    getPayloadSize() {
        return this.payload.byteLength;
    }

    /**
     * get this class size, it is (4 + payload size)
     * @returns 
     */
    getSize() {
        return 4 + this.getPayloadSize();
    }

    /**
     * get the NALU data, the format is: [payload size, payload data]
     * the first 4 bytes is the payload size, followed by payload data
     * @returns 
     */
    getData() {
        const result = new Uint8Array(this.getSize());
        const view = new DataView(result.buffer);
        view.setUint32(0, this.getSize() - 4);
        result.set(this.getPayload(), 4);
        return result;
    }
}
