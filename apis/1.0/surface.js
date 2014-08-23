/*
 The MIT License (MIT)

 Copyright (c) 2014 Duncan Meech / Algomation

 Permission is hereby granted, free of charge, to any person obtaining a copy
 of this software and associated documentation files (the "Software"), to deal
 in the Software without restriction, including without limitation the rights
 to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 copies of the Software, and to permit persons to whom the Software is
 furnished to do so, subject to the following conditions:

 The above copyright notice and this permission notice shall be included in
 all copies or substantial portions of the Software.

 THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 THE SOFTWARE.
 */

/*globals _, $*/
"use strict";

/**
 * namespaces for the render library
 * @namespace algo
 */
var algo = algo || {};

/**
 * @namespace
 */
algo.render = algo.render || {};

/**
 * an animation / display surface composed of n layers, each composed of n elements.
 */
algo.render.surface = function (options) {

    // setup singleton. There is only ever one surface so this is the best way to access it
    algo.SURFACE = this;

    // call reset on element class to ensure element ID's will match on this side
    // and the DOM side of the surface

    algo.render.Element.resetClass();

    // the options tell us if we are the worker or the dom version of the library

    this.options = options;

    // create our DOM element if we are DOM based

    if (this.isDOM) {

        // we expect the selector for a DOM element that we work on

        this.dom = options.domSelector;

        // maps commands to handlers

        this.commandHandlers = {};

        //this.commandHandlers[algo.render.surface.CREATE_COMMAND] = this.handleCreateCommand;

        this.commandHandlers[algo.render.surface.UPDATE_COMMAND] = this.handleUpdateCommand;

        this.commandHandlers[algo.render.surface.DESTROY_COMMAND] = this.handleDestroyCommand;


    } else {

        // create a queue of commands that will be passed to our DOM twin

        this.commands = [];

        // surface has a single element that acts as the root of the scene graph. We only create this for the worker
        // since its will be created on the DOM when the first commands are sent over.

        this.root = algo.ROOT = new algo.render.Rectangle({
            root       : true,
            visible    : false,
            x          : options.bounds.x,
            y          : options.bounds.y,
            w          : options.bounds.w,
            h          : options.bounds.h,
            strokeWidth: 0
        });

        // provide the bounds of the root element as a global

        algo.BOUNDS = this.root.getBounds();
    }
};

/**
 * true if we are the worker library
 */
algo.render.surface.prototype.__defineGetter__('isWorker', function () {

    return this.options.location === algo.render.surface.WORKER;
});

/**
 * true if we are the DOM library
 */
algo.render.surface.prototype.__defineGetter__('isDOM', function () {

    return this.options.location === algo.render.surface.DOM;
});

/**
 * these constants indicate the location of this instance of the surface
 * @type {string}
 */
algo.render.surface.WORKER = 'worker';

algo.render.surface.DOM = 'dom';

/**
 * these constants define all the commands that the worker may send to the DOM
 * @type {string}
 */
//algo.render.surface.CREATE_COMMAND = 'createElement';

algo.render.surface.UPDATE_COMMAND = 'updateElement';

algo.render.surface.DESTROY_COMMAND = 'destroyElement';

/**
 * when an element is created
 * @param element
 * @param options
 */
//algo.render.surface.prototype.elementCreated = function (element, options) {
//
//    // generate a create command if we are the worker
//
//    this.addCommand(algo.render.surface.CREATE_COMMAND, element, options);
//
//};

/**
 * when an element is destoryed
 * @param element
 * @param options
 */
algo.render.surface.prototype.elementDestroyed = function (element) {

    // generate a create command

    this.addCommand(algo.render.surface.DESTROY_COMMAND, element, {});

};


/**
 * when an elements properties are updated
 * @param element
 * @param options
 */
algo.render.surface.prototype.elementUpdated = function (element, options) {

    // generate a create command

    this.addCommand(algo.render.surface.UPDATE_COMMAND, element, options);

};

/**
 * create a command with the given name and clone a copy of the options but with the black listed options
 * removed e.g. the surface itself which we don't want serialized and set back to the DOM
 * also the parent since the parentID is all that is required
 * @param name
 * @param options
 */
algo.render.surface.prototype.addCommand = function (name, element, options) {

    // ignore if we aren't the worker side
    if (this.isDOM) {
        return;
    }

    // omit certain properties that don't need to get transmitted e.g. the array of states that each element has.
    // We also don't transmit the state property since it works by applying properties that will generate their own
    // commands

    // ( this also clones the options object )

    var c = _.omit(options, 'states', 'state');

    // replace parent element with parent id, otherwise the entire parent chain would get serialized

    if (options.parent) {
        c.parent = options.parent.id;
    }

    // add the element ID to all commands
    c.id = element.id;

    // if there is an update command for this element already in the buffer then just extend it with the new
    // options, otherwise create a new command

    if (name === algo.render.surface.UPDATE_COMMAND) {

        var existingCommand = _.find(this.commands, function (command) {

            return command.name === algo.render.surface.UPDATE_COMMAND && command.options.id === c.id;

        }, this);

        // if existing update command found for this item just extend it

        if (existingCommand) {

            _.extend(existingCommand.options, c);

            return;
        }
    }

    // add to command buffer

    this.commands.push({
        name   : name,
        options: c
    });
};

/**
 * return a shallow copy of our current commands and reset the buffer
 */
algo.render.surface.prototype.flushCommands = function () {

    var buffer = this.commands.slice();

    this.commands.length = 0;

    return buffer;
};

/**
 * execute commands from the worker on the dom
 */
algo.render.surface.prototype.executeCommands = function (commands) {

    // iterate all commands in the buffer

    _.each(commands, function (command) {

//        console.log("EX:" + command.name + " FOR:" + (command['options'] ? command.options.id : '---'));
//
//        console.log("OP:" + JSON.stringify(command.options, null, 4));

        // fix up some properties that were proxied in this.addCommand on the worker side

        var params = command.options;

        // replace parent ID with the real parent

        if (params.parent) {
            params.parent = algo.render.Element.findElement(params.parent);
        }

        // execute the command

        this.commandHandlers[command.name].call(this, command.options);

    }, this);

    // update the dom

    this.update();

    // validate

    this.validate();
};

///**
// * create element command handler
// * @param options
// */
//algo.render.surface.prototype.handleCreateCommand = function (options) {
//
//    // invoke the constructor for class using the name of the class
//
//    var e = new algo.render[options.type](options);
//
//    // if this was the root element assign it
//
//    if (options.root) {
//        this.root = algo.ROOT = e;
//    }
//
//    // the id of the new element will match the supplied ID if DOM/Worker are in sync
//
//    if (e.id !== options.id) {
//        throw new Error("Element ID mismatch");
//    }
//};



/**
 * update element command handler
 * @param options
 */
algo.render.surface.prototype.handleUpdateCommand = function (options) {

    // if this is new element we need to construct it

    var e = algo.render.Element.findElement(options.id);

    if (!e) {

        // invoke the constructor by name from the algo.render namespace
        e = new algo.render[options.type](options);

        // if this was the root element assign it
        if (options.root) {
            this.root = algo.ROOT = e;
        }

        // the id of the new element will match the supplied ID if DOM/Worker are in sync
        if (e.id !== options.id) {
            throw new Error("Element ID mismatch");
        }
    }

    // apply properties in the command
    e.set(options);

};


/**
 * If the options object contains any non empty arrays then return a clone
 * with the next value from each array exchanged for the array. Otherwise
 * return null
 * @param options
 */
algo.render.surface.prototype.processOptions = function (options) {

    // reset more flag in options,
    options.more = false;

    // create empty clone
    var clone = {};

    // process all keys
    _.each(options, function (value, key) {

        if (_.isArray(value)) {
            clone[key] = value.shift();

            // if the array is now empty then we can remove

            if (value.length === 0) {
                delete options[key];

            } else {

                // if not empty mark the options object as having more values
                options.more = true;
            }
        } else {
            clone[key] = value;
        }

    }, this);

    return clone;
};

/**
 * handle an element destory command
 * @param options
 */
algo.render.surface.prototype.handleDestroyCommand = function (options) {

    // get the element

    algo.render.Element.findElement(options.id).destroy();

};


/**
 * update the surface and all layers and all elements on those layers
 */
algo.render.surface.prototype.update = function () {

    // call update on the root element which recursively calls children

    this.root.update();

    // if the dom was just created then append to surface dom

    if (this.root.dom.parent().length === 0) {

        this.root.dom.appendTo(this.dom);
    }
};

/**
 * perform various validations of the state of the surface and the elements on it.
 */
algo.render.surface.prototype.validate = function () {

    // validate on DOM side only, but not in production
    if (this.isDOM && !algo.G.live) {

        // match elements on the surface / root element to those in the static element map

        var elements = $('.algo-element', this.root.element);

        _.each(elements, function (element) {

            var e = $(element);

            var id = e.attr('id');

            if (!algo.render.Element.map[id]) {

                throw new Error("Element in root not found in element map");
            }

        }, this);

        // basically the opposite, check that every element ID in the map is in the DOM

        _.each(algo.render.Element.map, function (element) {

            var id = element.id;

            var d = $('#' + id);

            if (d.length !== 1) {
                throw new Error("Element in map not found in DOM");
            }

        }, this);

        // ensure there is a one to one match

        if (elements.length !== _.keys(algo.render.Element.map).length) {

            throw new Error("Mismatch between length of static map and elements in root");
        }
    }
};
