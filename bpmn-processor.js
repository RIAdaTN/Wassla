import BpmnModdle from 'bpmn-moddle';
import { execute as aiProcess } from './ai-service.js';
import { generateLayout } from './bpmn-elk-processor.js';
async function generateFunctions(result, xml, userQuery) {
    if (result.type === 'question') {
        return [];
    }
    if (result.type === 'modification') {
        const lines = Array.isArray(result.content) ? result.content : [result.content];
        const functionCalls = lines
            .filter(line => typeof line === 'string' && line.includes('|'))
            .map(line => {
            const [processId, functionName, ...args] = line.split('|').map(s => s.trim());
            const parsedArgs = args.map(arg => {
                try {
                    if ((arg.startsWith('{') && arg.endsWith('}')) || (arg.startsWith('[') && arg.endsWith(']'))) {
                        return JSON.parse(arg);
                    }
                    return arg;
                }
                catch {
                    return arg;
                }
            });
            return { processId, functionName, args: parsedArgs };
        });
        return functionCalls;
    }
    return [];
}
export async function processBpmnXml(xml, userQuery) {
    try {
        const result = await aiProcess(xml, userQuery);
        if (result.type === 'question') {
            const answer = typeof result.content === 'string' ? result.content : (Array.isArray(result.content) ? result.content.join('\n') : 'No answer provided');
            return { queryType: result.type, type: 'message', content: answer };
        }
        if (result.type === 'creation') {
            const generatedXml = typeof result.content === 'string' ? result.content : (Array.isArray(result.content) ? result.content[0] : '');
            if (!generatedXml || generatedXml.trim().length === 0) {
                throw new Error('AI generated empty XML for creation');
            }
            const layoutedXml = await generateLayout(generatedXml);
            return { queryType: result.type, type: 'xml', content: layoutedXml };
        }
        if (result.type === 'modification') {
            const functionSequence = await generateFunctions(result, xml, userQuery);
            const moddle = new BpmnModdle();
            const { rootElement: definitions } = await moddle.fromXML(xml);
            const processes = new Map();
            // Collect all processes
            definitions.rootElements?.forEach((el) => {
                if (el.$type === 'bpmn:Process') {
                    if (!el.flowElements)
                        el.flowElements = [];
                    processes.set(el.id, el);
                }
            });
            for (const funcCall of functionSequence) {
                const { processId, functionName, args } = funcCall;
                const process = processes.get(processId);
                if (functionName === 'create') {
                    if (args[0] === 'bpmn:SequenceFlow') {
                        const sourceRef = process.flowElements.find((el) => el.id === args[1].sourceRef);
                        const targetRef = process.flowElements.find((el) => el.id === args[1].targetRef);
                        if (!sourceRef || !targetRef) {
                            console.warn(`Sequence flow creation failed: source or target not found`);
                            continue;
                        }
                        const element = moddle.create(args[0], {
                            id: args[1].id,
                            name: args[1].name,
                            conditionExpression: args[1].conditionExpression,
                            sourceRef,
                            targetRef
                        });
                        process.flowElements.push(element);
                    }
                    else if (args[0] === 'bpmn:MessageFlow') {
                        // Find source and target elements across all processes
                        const sourceElement = findElementById(definitions, args[1].sourceRef);
                        const targetElement = findElementById(definitions, args[1].targetRef);
                        if (!sourceElement || !targetElement) {
                            console.error(`Message flow creation failed: source (${args[1].sourceRef}) or target (${args[1].targetRef}) not found`);
                            continue;
                        }
                        // Create message flow with actual object references
                        const attrs = { ...args[1] };
                        attrs.sourceRef = sourceElement;
                        attrs.targetRef = targetElement;
                        const element = createMessageFlow(moddle, definitions, attrs);
                        // Update source and target elements to reference this message flow
                        if (sourceElement) {
                            if (!sourceElement.outgoing)
                                sourceElement.outgoing = [];
                            sourceElement.outgoing.push(element);
                        }
                        if (targetElement) {
                            if (!targetElement.incoming)
                                targetElement.incoming = [];
                            targetElement.incoming.push(element);
                        }
                    }
                    else {
                        const element = moddle.create(args[0], args[1]);
                        process.flowElements.push(element);
                    }
                }
                else if (functionName === 'removeTask') {
                    if (process)
                        removeTask(definitions, process, args[0]);
                }
                else if (functionName === 'replaceTask') {
                    if (process)
                        replaceTask(moddle, definitions, process, args[0], args[1]);
                }
                else if (functionName === 'removeMessageFlow' || functionName === 'removeOutgoing' || functionName === 'removeIncoming') {
                    // Support removing by id, name, or by source+target
                    if (args.length === 1) {
                        removeMessageFlow(definitions, args[0]);
                    }
                    else if (args.length === 2) {
                        removeMessageFlow(definitions, null, args[0], args[1]);
                    }
                }
                else if (functionName === 'removeSequenceFlow' ||
                    functionName === 'removeOutgoingSequence' ||
                    functionName === 'removeIncomingSequence') {
                    // Handle sequence flow removal
                    if (args.length === 1) {
                        removeSequenceFlow(process, args[0]);
                    }
                    else if (args.length === 2) {
                        removeSequenceFlow(process, null, args[0], args[1]);
                    }
                }
                else if (functionName === 'toXML') {
                    continue;
                }
            }
            const { xml: resultXml } = await moddle.toXML(definitions);
            const layoutedXml = await generateLayout(resultXml);
            return { queryType: result.type, type: 'xml', content: layoutedXml };
        }
        return { queryType: result.type, type: 'message', content: 'No valid response type' };
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        throw new Error(`Failed to process BPMN XML: ${errorMessage}`);
    }
}
/**
 * Create a message flow at the collaboration level
 */
function createMessageFlow(moddle, definitions, attrs) {
    // Find or create collaboration
    let collaboration = definitions.rootElements.find((el) => el.$type === 'bpmn:Collaboration');
    if (!collaboration) {
        collaboration = moddle.create('bpmn:Collaboration', { id: 'Collaboration_' + Date.now() });
        if (!definitions.get('rootElements')) {
            definitions.set('rootElements', []);
        }
        definitions.get('rootElements').push(collaboration);
    }
    if (!collaboration.messageFlows) {
        collaboration.messageFlows = [];
    }
    // Create the message flow
    const messageFlow = moddle.create('bpmn:MessageFlow', attrs);
    collaboration.messageFlows.push(messageFlow);
    return messageFlow;
}
/**
 * Helper function to find any element by ID across all processes
 */
function findElementById(definitions, elementId) {
    if (!definitions.rootElements)
        return null;
    for (const rootElement of definitions.rootElements) {
        if (rootElement.$type === 'bpmn:Process' && rootElement.flowElements) {
            const element = rootElement.flowElements.find((el) => el.id === elementId);
            if (element) {
                return element;
            }
        }
    }
    return null;
}
/**
 * Renumber all tasks globally across all processes (pools),
 * following their actual sequence order in each process.
 */
function renumberTasksGlobal(definitions) {
    const allTasks = [];
    for (const rootElement of definitions.rootElements || []) {
        if (rootElement.$type === "bpmn:Process" && rootElement.flowElements) {
            // Build a map of outgoing flows for quick traversal
            const outgoingMap = new Map();
            for (const el of rootElement.flowElements) {
                if (el.$type === "bpmn:SequenceFlow") {
                    const srcId = el.sourceRef?.id;
                    if (!srcId)
                        continue;
                    if (!outgoingMap.has(srcId))
                        outgoingMap.set(srcId, []);
                    outgoingMap.get(srcId).push(el.targetRef);
                }
            }
            // Find start events to begin traversal
            const startEvents = rootElement.flowElements.filter((el) => el.$type === "bpmn:StartEvent");
            const visited = new Set();
            const ordered = [];
            // Depth-first traversal to preserve visual/logical order
            function traverse(el) {
                if (!el || visited.has(el.id))
                    return;
                visited.add(el.id);
                if (el.$type.endsWith("Task"))
                    ordered.push(el);
                const nexts = outgoingMap.get(el.id) || [];
                for (const nxt of nexts)
                    traverse(nxt);
            }
            for (const start of startEvents)
                traverse(start);
            // Fallback if traversal misses some disconnected tasks
            const remaining = rootElement.flowElements.filter((el) => el.$type.endsWith("Task") && !visited.has(el.id));
            ordered.push(...remaining);
            allTasks.push(...ordered);
        }
    }
    // Now renumber tasks in traversal order (not by ID)
    allTasks.forEach((task, index) => {
        const originalName = task.name?.replace(/^\d+\.\s*/, "") || "Unnamed Task";
        task.name = `${index + 1}. ${originalName}`;
    });
}
/**
 * Remove task and its flows, then renumber all tasks globally across pools.
 */
function removeTask(definitions, process, taskId) {
    const task = process.flowElements.find((el) => el.id === taskId);
    if (!task)
        return;
    // Disconnect incoming/outgoing flows
    if (task.incoming) {
        for (const incomingFlow of task.incoming) {
            const src = process.flowElements.find((el) => el.id === incomingFlow.sourceRef?.id);
            if (src?.outgoing)
                src.outgoing = src.outgoing.filter((f) => f.id !== incomingFlow.id);
        }
    }
    if (task.outgoing) {
        for (const outgoingFlow of task.outgoing) {
            const tgt = process.flowElements.find((el) => el.id === outgoingFlow.targetRef?.id);
            if (tgt?.incoming)
                tgt.incoming = tgt.incoming.filter((f) => f.id !== outgoingFlow.id);
        }
    }
    // Remove task + its related flows
    process.flowElements = process.flowElements.filter((el) => el.id !== taskId &&
        !(el.$type === "bpmn:SequenceFlow" &&
            (el.sourceRef?.id === taskId || el.targetRef?.id === taskId)));
    // Renumber tasks globally across all pools
    renumberTasksGlobal(definitions);
}
/**
 * Remove a sequence flow inside a process.
 * Supports removal by id, or by (sourceId, targetId).
 */
function removeSequenceFlow(process, flowIdentifier, sourceId, targetId) {
    if (!process?.flowElements)
        return;
    let sf;
    if (flowIdentifier) {
        sf = process.flowElements.find((el) => el.$type === "bpmn:SequenceFlow" &&
            (el.id === flowIdentifier || el.name === flowIdentifier));
    }
    else if (sourceId && targetId) {
        sf = process.flowElements.find((el) => el.$type === "bpmn:SequenceFlow" &&
            el.sourceRef?.id === sourceId && el.targetRef?.id === targetId);
    }
    if (!sf)
        return;
    // Disconnect source and target
    if (sf.sourceRef?.outgoing) {
        sf.sourceRef.outgoing = sf.sourceRef.outgoing.filter((f) => f.id !== sf.id);
    }
    if (sf.targetRef?.incoming) {
        sf.targetRef.incoming = sf.targetRef.incoming.filter((f) => f.id !== sf.id);
    }
    // Remove from process
    process.flowElements = process.flowElements.filter((el) => el.id === sf.id);
    // Remove BPMNEdge
    const plane = process.$parent?.diagrams?.[0]?.plane;
    if (plane?.planeElement) {
        plane.planeElement = plane.planeElement.filter((el) => !(el.$type === "bpmndi:BPMNEdge" && el.bpmnElement === sf.id));
    }
}
/**
 * Remove a message flow (and its BPMNEdge).
 * Supports removal by id, by name, or by (sourceId, targetId).
 */
function removeMessageFlow(definitions, flowIdentifier, sourceId, targetId) {
    const collaboration = definitions.rootElements.find((el) => el.$type === "bpmn:Collaboration");
    if (!collaboration?.messageFlows)
        return;
    let mf;
    if (flowIdentifier) {
        mf = collaboration.messageFlows.find((mf) => mf.id === flowIdentifier || mf.name === flowIdentifier);
    }
    else if (sourceId && targetId) {
        mf = collaboration.messageFlows.find((mf) => mf.sourceRef?.id === sourceId && mf.targetRef?.id === targetId);
    }
    if (!mf)
        return;
    // Remove from collaboration
    collaboration.messageFlows = collaboration.messageFlows.filter((f) => f.id !== mf.id);
    // Remove BPMNEdge
    const plane = definitions.diagrams?.[0]?.plane;
    if (plane?.planeElement) {
        plane.planeElement = plane.planeElement.filter((el) => !(el.$type === "bpmndi:BPMNEdge" && el.bpmnElement === mf.id));
    }
}
/**
 * Replace a task while preserving:
 * - SequenceFlow labels
 * - MessageFlow references
 */
function replaceTask(moddle, definitions, process, oldTaskId, newTaskAttrs) {
    const oldTask = process.flowElements.find((el) => el.id === oldTaskId);
    if (!oldTask)
        return;
    if (typeof newTaskAttrs === "string") {
        newTaskAttrs = { name: newTaskAttrs };
    }
    if (!newTaskAttrs.$type || newTaskAttrs.$type === oldTask.$type) {
        Object.keys(newTaskAttrs).forEach((key) => {
            if (key !== "id" && key !== "$type") {
                oldTask[key] = newTaskAttrs[key];
            }
        });
        return;
    }
    const newTask = moddle.create(newTaskAttrs.$type, {
        ...newTaskAttrs,
        id: oldTask.id
    });
    // Preserve incoming flows
    if (oldTask.incoming) {
        for (const incoming of oldTask.incoming) {
            incoming.targetRef = newTask;
            if (!newTask.incoming)
                newTask.incoming = [];
            newTask.incoming.push(incoming);
        }
    }
    // Preserve outgoing flows
    if (oldTask.outgoing) {
        for (const outgoing of oldTask.outgoing) {
            outgoing.sourceRef = newTask;
            if (!newTask.outgoing)
                newTask.outgoing = [];
            newTask.outgoing.push(outgoing);
        }
    }
    // Update message flows if they reference this task
    const collaboration = definitions.rootElements.find((el) => el.$type === "bpmn:Collaboration");
    if (collaboration?.messageFlows) {
        for (const mf of collaboration.messageFlows) {
            if (mf.sourceRef?.id === oldTaskId)
                mf.sourceRef = newTask;
            if (mf.targetRef?.id === oldTaskId)
                mf.targetRef = newTask;
        }
    }
    // Update diagram elements if needed
    const plane = definitions.diagrams?.[0]?.plane;
    if (plane?.planeElement) {
        for (const edge of plane.planeElement) {
            if (edge.$type === "bpmndi:BPMNEdge") {
                const mf = collaboration?.messageFlows?.find((mf) => mf.id === edge.bpmnElement);
                if (mf) {
                    edge.bpmnElement = mf.id;
                }
            }
        }
    }
    // Replace the task in the process
    const idx = process.flowElements.findIndex((el) => el.id === oldTaskId);
    if (idx !== -1) {
        process.flowElements.splice(idx, 1, newTask);
    }
}
