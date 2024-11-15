;(function () {
    'use strict';

// registers the extension on a cytoscape lib ref
    var register = function (cytoscape) {

        if (!cytoscape) return; // Exit if cytoscape is undefined

        // Get scratch pad reserved for this extension on the given element or the core if 'name' parameter is not set,
        // if the 'name' parameter is set then return the related property in the scratch instead of the whole scratchpad
        function getScratch (eleOrCy, name) {

            if (eleOrCy.scratch("_undoRedo") === undefined) {
                eleOrCy.scratch("_undoRedo", {});
            }

            var scratchPad = eleOrCy.scratch("_undoRedo");

            return ( name === undefined ) ? scratchPad : scratchPad[name];
        }

        // Set the a field (described by 'name' parameter) of scratchPad (that is reserved for this extension
        // on an element or the core) to the given value (by 'val' parameter)
        function setScratch (eleOrCy, name, val) {

            var scratchPad = getScratch(eleOrCy);
            scratchPad[name] = val;
            eleOrCy.scratch("_undoRedo", scratchPad);
        }

        // Generate an instance of the extension for the given cy instance
        function generateInstance (cy) {
            return {
                options: {
                    isDebug: false, // Debug mode for console messages
                    actions: {},// actions to be added
                    undoableDrag: true, // Whether dragging nodes are undoable can be a function as well
                    stackSizeLimit: undefined, // Size limit of undo stack, note that the size of redo stack cannot exceed size of undo stack
                    beforeUndo: () => {}, // callback before undo is triggered.
                    afterUndo: () => {}, // callback after undo is triggered.
                    beforeRedo: () => {}, // callback before redo is triggered.
                    afterRedo: () => {}, // callback after redo is triggered.
                    ready: () => {},
                },
                actions: {},
                undoStack: [],
                redoStack: [],

                //resets undo and redo stacks
                reset(undos = [], redos = []) {
                    this.undoStack = undos;
                    this.redoStack = redos;
                },

                // Undo last action
                undo() {
                    if (this.isUndoStackEmpty()) {
                        if (this.options.isDebug) console.log("Undoing cannot be done because undo stack is empty!");
                        return;
                    }
                    var action = this.undoStack.pop();
                    cy.trigger("beforeUndo", [action.name, action.args]);

                    var res = this.actions[action.name]._undo(action.args);

                    this.redoStack.push({
                        name: action.name,
                        args: res
                    });

                    cy.trigger("afterUndo", [action.name, action.args, res]);
                    return res;

                },

                // Redo last action
                redo() {
                    if (this.isRedoStackEmpty()) {
                        if (this.options.isDebug) console.log("Redoing cannot be done because redo stack is empty!");
                        return;
                    }
                    var action = this.redoStack.pop();

                    cy.trigger(action.firstTime ? "beforeDo" : "beforeRedo", [action.name, action.args]);

                    action.args.firstTime = !!action.firstTime;

                    var res = this.actions[action.name]._do(action.args);

                    this.undoStack.push({
                        name: action.name,
                        args: res
                    });

                    if (this.options.stackSizeLimit != undefined && this.undoStack.length > this.options.stackSizeLimit) {
                        this.undoStack.shift();
                    }

                    cy.trigger(action.firstTime ? "afterDo" : "afterRedo", [action.name, action.args, res]);
                    return res;
                },

                // Calls registered function with action name actionName via actionFunction(args)
                do(actionName, args) {
                    this.redoStack.length = 0;
                    this.redoStack.push({
                        name: actionName,
                        args: args,
                        firstTime: true
                    });

                    return this.redo();
                },

                // Undo all actions in undo stack
                undoAll() {
                    while (!this.isUndoStackEmpty()) {
                        this.undo();
                    }
                },

                // Redo all actions in redo stack
                redoAll() {
                    while (!this.isRedoStackEmpty()) {
                        this.redo();
                    }
                },

                // Register action with its undo function & action name.
                action(actionName, _do, _undo) {
                    this.actions[actionName] = {
                        _do: _do,
                        _undo: _undo
                    }
                    return this;
                },

                // Removes action stated with actionName param
                removeAction(actionName) {
                    delete this.actions[actionName];
                },

                // Gets whether undo stack is empty
                isUndoStackEmpty() {
                    return (this.undoStack.length === 0);
                },

                // Gets whether redo stack is empty
                isRedoStackEmpty() {
                    return (this.redoStack.length === 0);
                },

                // Gets actions (with their args) in undo stack
                getUndoStack() {
                    return this.undoStack;
                },

                // Gets actions (with their args) in redo stack
                getRedoStack() {
                    return this.redoStack;
                },
            }
        }

        // design implementation
        cytoscape("core", "undoRedo", function (options, dontInit) {
            var cy = this;
            var instance = getScratch(cy, 'instance') || generateInstance(cy);
            setScratch(cy, 'instance', instance);

            if (options) {
                Object.assign(instance.options, options);
                Object.assign(instance.actions, options.actions);
            }

            if (!getScratch(cy, 'isInitialized') && !dontInit) {
                Object.assign(instance.actions, defaultActions(cy));
                setDragUndo(cy, instance.options.undoableDrag);
                setScratch(cy, 'isInitialized', true);
            }

            instance.options.ready();

            return instance;

        });

        function setDragUndo(cy, undoable) {
            var lastMouseDownNodeInfo = null;

            cy.on('grab', 'node', function () {
                if (typeof undoable === 'function' ? undoable.call(this) : undoable) {
                    lastMouseDownNodeInfo = {
                        lastMouseDownPosition: {
                            x: this.position('x'),
                            y: this.position('y')
                        },
                        node: this,
                    };
                }
            });

            cy.on("free", "node", function () {

                var instance = getScratch(cy, 'instance');

                if (typeof undoable === 'function' ? undoable.call(this) : undoable) {
                    if (!lastMouseDownNodeInfo) return;

                    const { node, lastMouseDownPosition } = lastMouseDownNodeInfo;
                    var mouseUpPosition = {
                        x: node.position("x"),
                        y: node.position("y")
                    };
                    if (mouseUpPosition.x != lastMouseDownPosition.x ||
                        mouseUpPosition.y != lastMouseDownPosition.y) {
                        var positionDiff = {
                            x: mouseUpPosition.x - lastMouseDownPosition.x,
                            y: mouseUpPosition.y - lastMouseDownPosition.y
                        };
                        const nodes = node.selected() ? cy.nodes(':visible').filter(':selected') : cy.collection([node]);
                        instance.do('drag', { positionDiff, nodes, move: false });
                        lastMouseDownNodeInfo = null;
                    }
                }
            });
        }

        // Default actions
        function defaultActions(cy) {

            function getTopMostNodes(nodes) {
                const nodesMap = new Set(nodes.map(node => node.id()));
                return nodes.filter(ele => {
                    let parent = ele.parent()[0];
                    while (parent) {
                        if (nodesMap.has(parent.id())) return false;
                        parent = parent.parent()[0];
                    }
                    return true;
                });
            }

            function moveNodes(positionDiff, nodes, notCalcTopMostNodes = false) {
                const topMostNodes = notCalcTopMostNodes ? nodes : getTopMostNodes(nodes);
                topMostNodes.forEach(node => {
                    if (!node.isParent()) {
                        node.position({
                            x: node.position('x') + positionDiff.x,
                            y: node.position('y') + positionDiff.y,
                        });
                    }
                    moveNodes(positionDiff, node.children(), true);
                });
            }

            function getEles(_eles) {
                return (typeof _eles === "string") ? cy.$(_eles) : _eles;
            }

            function restoreEles(_eles) {
                return getEles(_eles).restore();
            }


            function returnToPositions(positions) {
                var currentPositions = {};
                cy.nodes().not(":parent").positions(function (ele, i) {
                    if(typeof ele === "number") {
                      ele = i;
                    }

                    currentPositions[ele.id()] = {
                        x: ele.position("x"),
                        y: ele.position("y")
                    };
                    var pos = positions[ele.id()];
                    return {
                        x: pos.x,
                        y: pos.y
                    };
                });

                return currentPositions;
            }

            function getNodePositions() {
                var positions = {};
                var nodes = cy.nodes();
                for (var i = 0; i < nodes.length; i++) {
                    var node = nodes[i];
                    positions[node.id()] = {
                        x: node.position("x"),
                        y: node.position("y")
                    };
                }
                return positions;
            }

            function changeParentOld(param) {
              var result = {
              };
              // If this is first time we should move the node to its new parent and relocate it by given posDiff params
              // else we should remove the moved eles and restore the eles to restore
              if (param.firstTime) {
                var newParentId = param.parentData == undefined ? null : param.parentData;
                // These eles includes the nodes and their connected edges and will be removed in nodes.move().
                // They should be restored in undo
                var withDescendant = param.nodes.union(param.nodes.descendants());
                result.elesToRestore = withDescendant.union(withDescendant.connectedEdges());
                // These are the eles created by nodes.move(), they should be removed in undo.
                result.movedEles = param.nodes.move({"parent": newParentId});

                var posDiff = {
                  x: param.posDiffX,
                  y: param.posDiffY
                };

                moveNodes(posDiff, result.movedEles);
              }
              else {
                result.elesToRestore = param.movedEles.remove();
                result.movedEles = param.elesToRestore.restore();
              }

              if (param.callback) {
                result.callback = param.callback; // keep the provided callback so it can be reused after undo/redo
                param.callback(result.movedEles); // apply the callback on newly created elements
              }

              return result;
            }
            
            function changeParentNew(param) {
              var result = {
              };
              // If this is first time we should move the node to its new parent and relocate it by given posDiff params
              // else we should remove the moved eles and restore the eles to restore
              if (param.firstTime) {
                var newParentId = param.parentData == undefined ? null : param.parentData;
                // These eles includes the nodes and their connected edges and will be removed in nodes.move().
                // They should be restored in undo
                var withDescendant = param.nodes.union(param.nodes.descendants());
                var parentData = {};                
                withDescendant.forEach(function(ele){
                  if(ele.parent().id())
                    parentData[ele.id()] = ele.parent(); 
                  else
                    parentData[ele.id()] = null;
                });
                var positionData = {};
                withDescendant.forEach(function(ele){
                  positionData[ele.id()] = {};
                  positionData[ele.id()].x = ele.position('x');
                  positionData[ele.id()].y = ele.position('y');
                });                
                result.oldParent = parentData;
                result.oldPosition = positionData;
                result.newParent = newParentId;
                result.movedEles = withDescendant;
                param.nodes.move({"parent": newParentId}).nodes();
                var posDiff = {
                  x: param.posDiffX,
                  y: param.posDiffY
                };

                moveNodes(posDiff, result.movedEles);
              }
              else {
                result.oldParent = {};
                param.movedEles.forEach(function(ele){
                  if(ele.parent().id())
                    result.oldParent[ele.id()] = ele.parent(); 
                  else
                    result.oldParent[ele.id()] = null;
                });
                result.oldPosition = {};
                param.movedEles.forEach(function(ele){
                  result.oldPosition[ele.id()] = {};
                  result.oldPosition[ele.id()].x = ele.position("x");
                  result.oldPosition[ele.id()].y = ele.position("y");
                });                
                result.newParent = param.oldParent;
                result.movedEles = param.movedEles;
                result.movedEles.forEach(function(ele){
                  if(typeof result.newParent !== 'object')
                    ele.move({'parent': result.newParent});
                  else if(result.newParent[ele.id()] == null)
                    ele.move({'parent': null});
                  else
                    ele.move({'parent': result.newParent[ele.id()].id()});
                  
                  ele.position(param.oldPosition[ele.id()]);
                });
              }

              if (param.callback) {
                result.callback = param.callback; // keep the provided callback so it can be reused after undo/redo
                param.callback(result.movedEles); // apply the callback on newly created elements
              }

              return result;
            }         

            // function registered in the defaultActions below
            // to be used like .do('batch', actionList)
            // allows to apply any quantity of registered action in one go
            // the whole batch can be undone/redone with one key press
            function batch (actionList, doOrUndo) {
                var tempStack = []; // corresponds to the results of every action queued in actionList
                var instance = getScratch(cy, 'instance'); // get extension instance through cy
                var actions = instance.actions;

                // here we need to check in advance if all the actions provided really correspond to available functions
                // if one of the action cannot be executed, the whole batch is corrupted because we can't go back after
                for (var i = 0; i < actionList.length; i++) {
                    var action = actionList[i];
                    if (!actions.hasOwnProperty(action.name)) {
                        throw "Action " + action.name + " does not exist as an undoable function";
                    }
                }

                for (var i = 0; i < actionList.length; i++) {
                    var action = actionList[i];
                    // firstTime property is automatically injected into actionList by the do() function
                    // we use that to pass it down to the actions in the batch
                    action.param.firstTime = actionList.firstTime;
                    var actionResult;
                    if (doOrUndo == "undo") {
                        actionResult = actions[action.name]._undo(action.param);
                    }
                    else {
                        actionResult = actions[action.name]._do(action.param);
                    }

                    tempStack.unshift({
                        name: action.name,
                        param: actionResult
                    });
                }

                return tempStack;
            };

            return {
                "add": {
                    _do: function (eles) {
                        return eles.firstTime ? cy.add(eles) : restoreEles(eles);
                    },
                    _undo: cy.remove
                },
                "remove": {
                    _do: cy.remove,
                    _undo: restoreEles
                },
                "restore": {
                    _do: restoreEles,
                    _undo: cy.remove
                },
                "select": {
                    _do: function (_eles) {
                        return getEles(_eles).select();
                    },
                    _undo: function (_eles) {
                        return getEles(_eles).unselect();
                    }
                },
                "unselect": {
                    _do: function (_eles) {
                        return getEles(_eles).unselect();
                    },
                    _undo: function (_eles) {
                        return getEles(_eles).select();
                    }
                },
                "move": {
                    _do: function (args) {
                        var eles = getEles(args.eles);
                        var nodes = eles.nodes();
                        var edges = eles.edges();
                        
                        var oldNodesParents = [];
                        var oldEdgesSources = [];
                        var oldEdgesTargets = [];
                        
                        nodes.forEach(function(node){
                          oldNodesParents.push(node.parent().length > 1 ? node.parent().id() : null);
                        });
                        edges.forEach(function(edge){
                          oldEdgesSources.push(edge.source().id());
                          oldEdgesTargets.push(edge.target().id());
                        })
                        
                        return {
                            oldNodesParents: oldNodesParents,
                            newNodes: nodes.move(args.location),
                            oldEdgesSources: oldEdgesSources,
                            oldEdgesTargets: oldEdgesTargets,
                            newEdges: edges.move(args.location)
                        };
                    },
                    _undo: function (eles) {
                        var newEles = cy.collection();
                        var location = {};
                        if (eles.newNodes.length > 0) {
                            location.parent = eles.newNodes[0].parent().id();

                            for (var i = 0; i < eles.newNodes.length; i++) {
                                var newNode = eles.newNodes[i].move({
                                    parent: eles.oldNodesParents[i]
                                });
                                newEles = newEles.union(newNode);
                            }
                        } else {
                            location.source = eles.newEdges[0].source().id();
                            location.target = eles.newEdges[0].target().id();

                            for (var i = 0; i < eles.newEdges.length; i++) {
                                var newEdge = eles.newEdges[i].move({
                                    source: eles.oldEdgesSources[i],
                                    target: eles.oldEdgesTargets[i]
                                });
                                newEles = newEles.union(newEdge);
                            }
                        }
                        return {
                            eles: newEles,
                            location: location
                        };
                    }
                },
                "drag": {
                    _do: function (args) {
                        if (args.move){
                            moveNodes(args.positionDiff, args.nodes);
                            cy.elements().unselect();
                        }
                           
                        return args;
                    },
                    _undo: function (args) {
                        var diff = {
                            x: -1 * args.positionDiff.x,
                            y: -1 * args.positionDiff.y
                        };
                        var result = {
                            positionDiff: args.positionDiff,
                            nodes: args.nodes,
                            move: true
                        };
                        moveNodes(diff, args.nodes);
                        cy.elements().unselect();
                        return result;
                    }
                },
                "layout": {
                    _do: function (args) {
                        if (args.firstTime){
                            var positions = getNodePositions();
                            var layout;
                            if(args.eles) {
                              layout = getEles(args.eles).layout(args.options);
                            }
                            else {
                              layout = cy.layout(args.options);
                            }
                            
                            // Do this check for cytoscape.js backward compatibility
                            if (layout && layout.run) {
                              layout.run();
                            }
                            
                            return positions;
                        } else
                            return returnToPositions(args);
                    },
                    _undo: function (nodesData) {
                        return returnToPositions(nodesData);
                    }
                },
                "changeParent": {
                    _do: function (args) {                     
                        return (cy.nodes()[0].component ? changeParentNew(args) : changeParentOld(args));
                    },
                    _undo: function (args) {
                        return (cy.nodes()[0].component ? changeParentNew(args) : changeParentOld(args));
                    }
                },
                "batch": {
                    _do: function (args) {
                        return batch(args, "do");
                    },
                    _undo: function (args) {
                        return batch(args, "undo");
                    }
                }
            };
        }

    };

    if (typeof module !== 'undefined' && module.exports) { // expose as a commonjs module
        module.exports = register;
    }

    if (typeof define !== 'undefined' && define.amd) { // expose as an amd/requirejs module
        define('cytoscape.js-undo-redo', function () {
            return register;
        });
    }

    if (typeof cytoscape !== 'undefined') { // expose to global cytoscape (i.e. window.cytoscape)
        register(cytoscape);
    }

})();
