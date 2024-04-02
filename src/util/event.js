/**
 * the Event
 * the event data structure format:
 * {
 *     'event1' : [func1, func2, func3],
 *     'event2' : [func4, func5, func6, func7],
 *     'event3' : [func8, func9, func10, func11]
 *     ........
 * }
 */
export default class Event {
    /**
     * constructor
     * @param {*} type -- the type of event
     */
    constructor(type) {
        this.listener = {};
        this.type = type | '';
    }

    /**
     * add event listener
     * @param {*} event -- the event
     * @param {*} fn -- the listener function
     * @returns 
     */
    on(event, fn) {
        if (!this.listener[event]) {
            this.listener[event] = [];
        }
        this.listener[event].push(fn);
        return true;
    }

    /**
     * remove the event listener
     * @param {*} event -- the event
     * @param {*} fn -- the listener function
     * @returns 
     */
    off(event, fn) {
        if (this.listener[event]) {
            let index = this.listener[event].indexOf(fn);
            if (index > -1) {
                this.listener[event].splice(index, 1);
            }
            return true;
        }
        return false;
    }

    /**
     * remove all the event listener
     */
    offAll() {
        this.listener = {};
    }

    /**
     * dispatch the listener functions
     * @param {*} event -- the event
     * @param {*} data -- the function parameters
     * @returns 
     */
    dispatch(event, data) {
        if (this.listener[event]) {
            this.listener[event].map((each) => {
                each.apply(null, [data]);
            });
            return true;
        }
        return false;
    }
}
