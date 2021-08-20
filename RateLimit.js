
class RateLimit {
	constructor(interval_ms = 0) {
		this._interval_ms = interval_ms; // (0 means no limit)
		this._after = Date.now() - interval_ms;
	}
	check(time = Date.now()) {
		return (time >= this._after);
	}
	attempt(time = Date.now()) {
		if(time < this._after) return false;
		this._after = time + this._interval_ms;
		return true;
	}
	setInterval(interval_ms) {
		this._after += interval_ms - this._interval_ms;
		this._interval_ms = interval_ms;
	}
}

class RateLimitChain {
	constructor(num, interval_ms) {
		this.setNumAndInterval(num, interval_ms);
	}
	check(time = Date.now()) {
		for(let i = 0; i < this._chain.length; i++) {
			if(this._chain[i].check(time)) return true;
		}
		return false;
	}
	attempt(time = Date.now()) {
		for(let i = 0; i < this._chain.length; i++) {
			if(this._chain[i].attempt(time)) return true;
		}
		return false;
	}
	setNumAndInterval(num, interval_ms) {
		this._chain = [];
		for(let i = 0; i < num; i++) {
			this._chain.push(new RateLimit(interval_ms));
		}
	}
}

class DataRateLimit {
	constructor(limit, interval_ms = 0) {
		this._limit = limit;
		this._interval_ms = interval_ms; // (0 means per-attempt)
		this._after = 0;
		this._size = 0;
	}
	check(size, time = Date.now()) {
		return (time >= this._after || this._size + size <= this._limit);
	}
	attempt(size, time = Date.now()) {
		if(time >= this._after) {
			this._size = 0;
			this._after = time + this._interval_ms;
		}
		if(this._size + size <= this._limit) {
			this._size += size;
			return true;
		} else {
			return false;
		}
	}
}

var exports = typeof module !== "undefined" ? module.exports : this;
exports.RateLimit = RateLimit;
exports.RateLimitChain = RateLimitChain;
exports.DataRateLimit = DataRateLimit;
