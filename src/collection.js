/* global Thumb, Super */

///////////////////////////
///   THE COLLECTION    ///
///////////////////////////

function Collection (manager, options) {
    var self = this;
    self.thumbs = [];
    self.idles = [];
    self.actives = [];
    self.ids = [];
    self.pressureIntervals = {};
    self.manager = manager;
    self.id = Collection.id;
    Collection.id += 1;

    // Defaults
    self.defaults = {
        zone: document.body,
        multitouch: false,
        maxNumberOfThumbs: 10,
        mode: 'dynamic',
        position: {top: 0, left: 0},
        catchDistance: 200,
        size: 100,
        threshold: 0.1,
        color: 'white',
        fadeTime: 250,
        dataOnly: false,
        restJoystick: true,
        restOpacity: 0.5,
        lockX: false,
        lockY: false
    };

    self.config(options);

    // Overwrites
    if (self.options.mode === 'static' || self.options.mode === 'semi') {
        self.options.multitouch = false;
    }

    if (!self.options.multitouch) {
        self.options.maxNumberOfThumbs = 1;
    }

    self.updateBox();
    self.prepareThumbs();
    self.bindings();
    self.begin();

    return self.thumbs;
}

Collection.prototype = new Super();
Collection.constructor = Collection;
Collection.id = 0;

Collection.prototype.prepareThumbs = function () {
    var self = this;
    var nips = self.thumbs;

    // Public API Preparation.
    nips.on = self.on.bind(self);
    nips.off = self.off.bind(self);
    nips.options = self.options;
    nips.destroy = self.destroy.bind(self);
    nips.ids = self.ids;
    nips.id = self.id;
    nips.processOnMove = self.processOnMove.bind(self);
    nips.processOnEnd = self.processOnEnd.bind(self);
    nips.get = function (id) {
        if (id === undefined) {
            return nips[0];
        }
        for (var i = 0, max = nips.length; i < max; i += 1) {
            if (nips[i].identifier === id) {
                return nips[i];
            }
        }
        return false;
    };
};

Collection.prototype.bindings = function () {
    var self = this;
    // Touch start event.
    self.bindEvt(self.options.zone, 'start');
    // Avoid native touch actions (scroll, zoom etc...) on the zone.
    self.options.zone.style.touchAction = 'none';
    self.options.zone.style.msTouchAction = 'none';
};

Collection.prototype.begin = function () {
    var self = this;
    var opts = self.options;

    // We place our static thumbstick
    // if needed.
    if (opts.mode === 'static') {
        var thumbstick = self.createThumb(
            opts.position,
            self.manager.getIdentifier()
        );
        // Add it to the dom.
        thumbstick.add();
        // Store it in idles.
        self.idles.push(thumbstick);
    }
};

// Thumb Factory
Collection.prototype.createThumb = function (position, identifier) {
    var self = this;
    var scroll = u.getScroll();
    var toPutOn = {};
    var opts = self.options;

    if (position.x && position.y) {
        toPutOn = {
            x: position.x -
                (scroll.x + self.box.left),
            y: position.y -
                (scroll.y + self.box.top)
        };
    } else if (
            position.top ||
            position.right ||
            position.bottom ||
            position.left
        ) {

        // We need to compute the position X / Y of the joystick.
        var dumb = document.createElement('DIV');
        dumb.style.display = 'hidden';
        dumb.style.top = position.top;
        dumb.style.right = position.right;
        dumb.style.bottom = position.bottom;
        dumb.style.left = position.left;
        dumb.style.position = 'absolute';

        opts.zone.appendChild(dumb);
        var dumbBox = dumb.getBoundingClientRect();
        opts.zone.removeChild(dumb);

        toPutOn = position;
        position = {
            x: dumbBox.left + scroll.x,
            y: dumbBox.top + scroll.y
        };
    }

    var thumbstick = new Thumb(self, {
        color: opts.color,
        size: opts.size,
        threshold: opts.threshold,
        fadeTime: opts.fadeTime,
        dataOnly: opts.dataOnly,
        restJoystick: opts.restJoystick,
        restOpacity: opts.restOpacity,
        mode: opts.mode,
        identifier: identifier,
        position: position,
        zone: opts.zone,
        frontPosition: {
            x: 0,
            y: 0
        }
    });

    if (!opts.dataOnly) {
        u.applyPosition(thumbstick.ui.el, toPutOn);
        u.applyPosition(thumbstick.ui.front, thumbstick.frontPosition);
    }
    self.thumbs.push(thumbstick);
    self.trigger('added ' + thumbstick.identifier + ':added', thumbstick);
    self.manager.trigger('added ' + thumbstick.identifier + ':added', thumbstick);

    self.bindThumb(thumbstick);

    return thumbstick;
};

Collection.prototype.updateBox = function () {
    var self = this;
    self.box = self.options.zone.getBoundingClientRect();
};

Collection.prototype.bindThumb = function (thumbstick) {
    var self = this;
    var type;
    // Bubble up identified events.
    var handler = function (evt, data) {
        // Identify the event type with the thumbstick's id.
        type = evt.type + ' ' + data.id + ':' + evt.type;
        self.trigger(type, data);
    };

    // When it gets destroyed.
    thumbstick.on('destroyed', self.onDestroyed.bind(self));

    // Other events that will get bubbled up.
    thumbstick.on('shown hidden rested dir plain', handler);
    thumbstick.on('dir:up dir:right dir:down dir:left', handler);
    thumbstick.on('plain:up plain:right plain:down plain:left', handler);
};

Collection.prototype.pressureFn = function (touch, thumbstick, identifier) {
    var self = this;
    var previousPressure = 0;
    clearInterval(self.pressureIntervals[identifier]);
    // Create an interval that will read the pressure every 100ms
    self.pressureIntervals[identifier] = setInterval(function () {
        var pressure = touch.force || touch.pressure ||
            touch.webkitForce || 0;
        if (pressure !== previousPressure) {
            thumbstick.trigger('pressure', pressure);
            self.trigger('pressure ' +
                thumbstick.identifier + ':pressure', pressure);
            previousPressure = pressure;
        }
    }.bind(self), 100);
};

Collection.prototype.onstart = function (evt) {
    var self = this;
    var opts = self.options;
    evt = u.prepareEvent(evt);

    // Update the box position
    self.updateBox();

    var process = function (touch) {
        // If we can create new thumbs
        // meaning we don't have more active thumbs than we should.
        if (self.actives.length < opts.maxNumberOfThumbs) {
            self.processOnStart(touch);
        }
    };

    u.map(evt, process);

    // We ask upstream to bind the document
    // on 'move' and 'end'
    self.manager.bindDocument();
    return false;
};

Collection.prototype.processOnStart = function (evt) {
    var self = this;
    var opts = self.options;
    var indexInIdles;
    var identifier = self.manager.getIdentifier(evt);
    var pressure = evt.force || evt.pressure || evt.webkitForce || 0;
    var position = {
        x: evt.pageX,
        y: evt.pageY
    };

    var thumbstick = self.getOrCreate(identifier, position);

    // Update its touch identifier
    if (thumbstick.identifier !== identifier) {
        self.manager.removeIdentifier(thumbstick.identifier);
    }
    thumbstick.identifier = identifier;

    var process = function (nip) {
        // Trigger the start.
        nip.trigger('start', nip);
        self.trigger('start ' + nip.id + ':start', nip);

        nip.show();
        if (pressure > 0) {
            self.pressureFn(evt, nip, nip.identifier);
        }
        // Trigger the first move event.
        self.processOnMove(evt);
    };

    // Transfer it from idles to actives.
    if ((indexInIdles = self.idles.indexOf(thumbstick)) >= 0) {
        self.idles.splice(indexInIdles, 1);
    }

    // Store the thumbstick in the actives array
    self.actives.push(thumbstick);
    self.ids.push(thumbstick.identifier);

    if (opts.mode !== 'semi') {
        process(thumbstick);
    } else {
        // In semi we check the distance of the touch
        // to decide if we have to reset the thumbstick
        var distance = u.distance(position, thumbstick.position);
        if (distance <= opts.catchDistance) {
            process(thumbstick);
        } else {
            thumbstick.destroy();
            self.processOnStart(evt);
            return;
        }
    }

    return thumbstick;
};

Collection.prototype.getOrCreate = function (identifier, position) {
    var self = this;
    var opts = self.options;
    var thumbstick;

    // If we're in static or semi, we might already have an active.
    if (/(semi|static)/.test(opts.mode)) {
        // Get the active one.
        // TODO: Multi-touche for semi and static will start here.
        // Return the nearest one.
        thumbstick = self.idles[0];
        if (thumbstick) {
            self.idles.splice(0, 1);
            return thumbstick;
        }

        if (opts.mode === 'semi') {
            // If we're in semi mode, we need to create one.
            return self.createThumb(position, identifier);
        }

        console.warn('Coudln\'t find the needed thumbstick.');
        return false;
    }
    // In dynamic, we create a new one.
    thumbstick = self.createThumb(position, identifier);
    return thumbstick;
};

Collection.prototype.processOnMove = function (evt) {
    var self = this;
    var opts = self.options;
    var identifier = self.manager.getIdentifier(evt);
    var thumbstick = self.thumbs.get(identifier);

    if (!thumbstick) {
        // This is here just for safety.
        // It shouldn't happen.
        console.error('Found zombie joystick with ID ' + identifier);
        self.manager.removeIdentifier(identifier);
        return;
    }

    thumbstick.identifier = identifier;

    var size = thumbstick.options.size / 2;
    var pos = {
        x: evt.pageX,
        y: evt.pageY
    };

    var dist = u.distance(pos, thumbstick.position);
    var angle = u.angle(pos, thumbstick.position);
    var rAngle = u.radians(angle);
    var force = dist / size;

    // If distance is bigger than thumbstick's size
    // we clamp the position.
    if (dist > size) {
        dist = size;
        pos = u.findCoord(thumbstick.position, dist, angle);
    }

    var xPosition = pos.x - thumbstick.position.x
    var yPosition = pos.y - thumbstick.position.y

    if (opts.lockX){
        yPosition = 0
    }
    if (opts.lockY) {
        xPosition = 0
    }

    thumbstick.frontPosition = {
        x: xPosition,
        y: yPosition
    };

    if (!opts.dataOnly) {
        u.applyPosition(thumbstick.ui.front, thumbstick.frontPosition);
    }

    // Prepare event's datas.
    var toSend = {
        identifier: thumbstick.identifier,
        position: pos,
        force: force,
        pressure: evt.force || evt.pressure || evt.webkitForce || 0,
        distance: dist,
        angle: {
            radian: rAngle,
            degree: angle
        },
        instance: thumbstick,
        lockX: opts.lockX,
        lockY: opts.lockY
    };

    // Compute the direction's datas.
    toSend = thumbstick.computeDirection(toSend);

    // Offset angles to follow units circle.
    toSend.angle = {
        radian: u.radians(180 - angle),
        degree: 180 - angle
    };

    // Send everything to everyone.
    thumbstick.trigger('move', toSend);
    self.trigger('move ' + thumbstick.id + ':move', toSend);
};

Collection.prototype.processOnEnd = function (evt) {
    var self = this;
    var opts = self.options;
    var identifier = self.manager.getIdentifier(evt);
    var thumbstick = self.thumbs.get(identifier);
    var removedIdentifier = self.manager.removeIdentifier(thumbstick.identifier);

    if (!thumbstick) {
        return;
    }

    if (!opts.dataOnly) {
        thumbstick.hide(function () {
            if (opts.mode === 'dynamic') {
                thumbstick.trigger('removed', thumbstick);
                self.trigger('removed ' + thumbstick.id + ':removed', thumbstick);
                self.manager
                    .trigger('removed ' + thumbstick.id + ':removed', thumbstick);
                thumbstick.destroy();
            }
        });
    }

    // Clear the pressure interval reader
    clearInterval(self.pressureIntervals[thumbstick.identifier]);

    // Reset the direciton of the thumbstick, to be able to trigger a new direction
    // on start.
    thumbstick.resetDirection();

    thumbstick.trigger('end', thumbstick);
    self.trigger('end ' + thumbstick.id + ':end', thumbstick);

    // Remove identifier from our bank.
    if (self.ids.indexOf(thumbstick.identifier) >= 0) {
        self.ids.splice(self.ids.indexOf(thumbstick.identifier), 1);
    }

    // Clean our actives array.
    if (self.actives.indexOf(thumbstick) >= 0) {
        self.actives.splice(self.actives.indexOf(thumbstick), 1);
    }

    if (/(semi|static)/.test(opts.mode)) {
        // Transfer thumbstick from actives to idles
        // if we're in semi or static mode.
        self.idles.push(thumbstick);
    } else if (self.thumbs.indexOf(thumbstick) >= 0) {
        // Only if we're not in semi or static mode
        // we can remove the instance.
        self.thumbs.splice(self.thumbs.indexOf(thumbstick), 1);
    }

    // We unbind move and end.
    self.manager.unbindDocument();

    // We add back the identifier of the idle thumbstick;
    if (/(semi|static)/.test(opts.mode)) {
        self.manager.ids[removedIdentifier.id] = removedIdentifier.identifier;
    }
};

// Remove destroyed thumbstick from the lists
Collection.prototype.onDestroyed = function(evt, thumbstick) {
    var self = this;
    if (self.thumbs.indexOf(thumbstick) >= 0) {
        self.thumbs.splice(self.thumbs.indexOf(thumbstick), 1);
    }
    if (self.actives.indexOf(thumbstick) >= 0) {
        self.actives.splice(self.actives.indexOf(thumbstick), 1);
    }
    if (self.idles.indexOf(thumbstick) >= 0) {
        self.idles.splice(self.idles.indexOf(thumbstick), 1);
    }
    if (self.ids.indexOf(thumbstick.identifier) >= 0) {
        self.ids.splice(self.ids.indexOf(thumbstick.identifier), 1);
    }

    // Remove the identifier from our bank
    self.manager.removeIdentifier(thumbstick.identifier);

    // We unbind move and end.
    self.manager.unbindDocument();
};

// Cleanly destroy the manager
Collection.prototype.destroy = function () {
    var self = this;
    self.unbindEvt(self.options.zone, 'start');

    // Destroy thumbs.
    self.thumbs.forEach(function(thumbstick) {
        thumbstick.destroy();
    });

    // Clean 3DTouch intervals.
    for (var i in self.pressureIntervals) {
        if (self.pressureIntervals.hasOwnProperty(i)) {
            clearInterval(self.pressureIntervals[i]);
        }
    }

    // Notify the manager passing the instance
    self.trigger('destroyed', self.thumbs);
    // We unbind move and end.
    self.manager.unbindDocument();
    // Unbind everything.
    self.off();
};
