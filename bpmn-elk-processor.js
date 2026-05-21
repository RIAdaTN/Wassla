import BpmnModdle from 'bpmn-moddle';
import ELK from 'elkjs/lib/elk.bundled.js';

// Create ELK instance — disable Web Workers explicitly for Node.js
const elk = new ELK({
  workerUrl: null,
});

function center(b) {
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}
function orthogonalRoute(source, target) {
    const sc = center(source);
    const tc = center(target);
    let start;
    let end;
    const bends = [];
    if (sc.y < tc.y) {
        // Source is ABOVE target → bottom → top
        start = { x: sc.x, y: source.y + source.height };
        end = { x: tc.x, y: target.y };
    }
    else if (sc.y === tc.y && sc.x !== tc.x) {
        // Source and target are horizontally aligned → bottom → bottom
        start = { x: sc.x, y: source.y + source.height };
        end = { x: tc.x, y: target.y + target.height };
    }
    else {
        // Source is BELOW target → top → bottom
        start = { x: sc.x, y: source.y };
        end = { x: tc.x, y: target.y + target.height };
    }
    // Compute mid vertical level
    const midY_test = (start.y + end.y) / 2;
    const midY = ((start.y + end.y) / 2) - ((start.y + end.y) / 2) / 5;
    const dy = start.y - midY_test; // Difference in y coordinates
    const distance = Math.sqrt(dy * dy);
    if (distance <= source.width) {
        bends.push({ x: start.x, y: midY_test });
        bends.push({ x: end.x, y: midY_test });
    }
    else {
        bends.push({ x: start.x, y: midY });
        bends.push({ x: end.x, y: midY });
    }
    return { start, bends, end };
}
export async function transformBpmnToElk(bpmnXml) {
    const moddle = new BpmnModdle();
    // Use bundled ELK (no Web Workers needed in Node.js)
    try {
        const { rootElement: definitions } = await moddle.fromXML(bpmnXml);
        const elkGraph = {
            id: 'root',
            layoutOptions: {
                "elk.algorithm": "layered",
                "elk.direction": "DOWN",
                "elk.partitioning.partition": "true",
                "elk.layered.crossingMinimization.semiInteractive": "true",
                "elk.partitioning.activate": "true",
                "elk.partitioning.spacing": "100",
                "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
                "elk.spacing.nodeNode": "50",
                "elk.spacing.nodeNodeBetweenLayers": "80",
                "elk.layered.spacing.nodeNodeBetweenLayers": "180",
                "elk.layered.spacing.nodeNode": "50",
                "elk.layered.spacing.edgeNodeBetweenLayers": "60",
                "elk.layered.nodePlacement.strategy": "SIMPLE",
                "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
            },
            children: [],
            edges: []
        };
        let hasCollaboration = false;
        const processedProcessIds = new Set();
        if (definitions.rootElements) {
            for (const rootElement of definitions.rootElements) {
                if (rootElement.$type === 'bpmn:Collaboration') {
                    hasCollaboration = true;
                    processCollaboration(rootElement, elkGraph);
                    if (rootElement.participants) {
                        for (const participant of rootElement.participants) {
                            if (participant.processRef) {
                                processedProcessIds.add(participant.processRef.id);
                            }
                        }
                    }
                }
            }
            if (!hasCollaboration) {
                for (const rootElement of definitions.rootElements) {
                    if (rootElement.$type === 'bpmn:Process') {
                        processProcess(rootElement, elkGraph);
                    }
                }
            }
            else {
                for (const rootElement of definitions.rootElements) {
                    if (rootElement.$type === 'bpmn:Process' && !processedProcessIds.has(rootElement.id)) {
                        processProcess(rootElement, elkGraph);
                    }
                }
            }
        }
        // PASS 1: Initial layout
        const layoutedGraph = await elk.layout(elkGraph);
        // PASS 2: Route root edges
        const externalEdges = [...(layoutedGraph.edges || [])];
        const taskIds = new Set();
        for (const e of externalEdges) {
            if (e.sources?.[0])
                taskIds.add(e.sources[0]);
            if (e.targets?.[0])
                taskIds.add(e.targets[0]);
        }
        const externalNodes = [];
        const seen = new Set();
        for (const participant of layoutedGraph.children || []) {
            for (const task of participant.children || []) {
                if (!taskIds.has(task.id))
                    continue;
                if (seen.has(task.id))
                    continue;
                const absX = (participant.x || 0) + (task.x || 0);
                const absY = (participant.y || 0) + (task.y || 0);
                externalNodes.push({
                    id: task.id,
                    width: task.width,
                    height: task.height,
                    x: absX,
                    y: absY,
                    layoutOptions: {
                        "org.eclipse.elk.position": `${absX},${absY}`,
                        "org.eclipse.elk.fixed": "true",
                        "elk.algorithm": "org.eclipse.elk.fixed",
                    },
                });
                seen.add(task.id);
            }
        }
        const externalEdgesWithSections = externalEdges.map(e => {
            const sourceNode = externalNodes.find(n => n.id === e.sources?.[0]);
            const targetNode = externalNodes.find(n => n.id === e.targets?.[0]);
            if (!sourceNode || !targetNode)
                return e;
            const { start, bends, end } = orthogonalRoute({ x: sourceNode.x, y: sourceNode.y, width: sourceNode.width, height: sourceNode.height }, { x: targetNode.x, y: targetNode.y, width: targetNode.width, height: targetNode.height });
            return {
                ...e,
                sections: [
                    {
                        id: e.id,
                        startPoint: start,
                        bendPoints: bends,
                        endPoint: end,
                    },
                ],
            };
        });
        const edgeRoutingGraph = {
            id: "externalEdgesGraph",
            layoutOptions: {
                "elk.algorithm": "fixed",
                "org.eclipse.elk.fixed": "true",
            },
            children: externalNodes,
            edges: externalEdgesWithSections,
        };
        const routedGraph = await elk.layout(edgeRoutingGraph);
        // Merge routed edge sections back into original layoutedGraph
        const routedEdgesMap = new Map();
        if (routedGraph.edges) {
            for (const e of routedGraph.edges) {
                routedEdgesMap.set(e.id, e);
            }
        }
        if (layoutedGraph.edges) {
            for (const e of layoutedGraph.edges) {
                const routed = routedEdgesMap.get(e.id);
                if (routed && routed.sections) {
                    e.sections = routed.sections;
                }
            }
        }
        return layoutedGraph;
    }
    catch (error) {
        console.error('Error transforming BPMN to ELK:', error);
        throw new Error(`Failed to transform BPMN to ELK: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}
function processCollaboration(collaboration, elkGraph) {
    if (collaboration.participants) {
        for (const participant of collaboration.participants) {
            const poolNode = {
                id: participant.id,
                width: 1000,
                height: 200,
                children: [],
                edges: [],
                layoutOptions: {
                    'elk.padding': '[top=50,left=100,bottom=50,right=100]',
                    "elk.algorithm": "layered",
                    "elk.direction": "RIGHT",
                    "elk.spacing.nodeNodeBetweenLayers": "80",
                    "elk.spacing.nodeNode": "50",
                    "elk.alignment": "CENTER",
                    "elk.layered.nodePlacement.strategy": "SIMPLE",
                    "elk.spacing.edgeEdge": "100",
                    "elk.partitioning.partitionSpacing": "50",
                    "elk.layered.spacing.edgeNodeBetweenLayers": "50",
                }
            };
            elkGraph.children.push(poolNode);
            if (participant.processRef) {
                processProcess(participant.processRef, poolNode);
            }
        }
    }
    if (collaboration.messageFlows) {
        for (const messageFlow of collaboration.messageFlows) {
            const elkEdge = createMessageFlowEdge(messageFlow);
            if (elkEdge) {
                elkGraph.edges.push(elkEdge);
            }
        }
    }
}
function processProcess(process, elkParent) {
    if (!process.flowElements) {
        return;
    }
    for (const element of process.flowElements) {
        if (element.$type !== 'bpmn:SequenceFlow') {
            const elkNode = createElkNode(element);
            elkParent.children.push(elkNode);
        }
    }
    for (const element of process.flowElements) {
        if (element.$type === 'bpmn:SequenceFlow') {
            const elkEdge = createElkEdge(element);
            if (elkEdge) {
                elkParent.edges.push(elkEdge);
            }
        }
    }
}
function createElkNode(element) {
    const nodeType = element.$type;
    let width = 100;
    let height = 80;
    switch (nodeType) {
        case 'bpmn:StartEvent':
        case 'bpmn:EndEvent':
        case 'bpmn:IntermediateThrowEvent':
        case 'bpmn:IntermediateCatchEvent':
            width = 36;
            height = 36;
            break;
        case 'bpmn:ExclusiveGateway':
        case 'bpmn:ParallelGateway':
        case 'bpmn:InclusiveGateway':
        case 'bpmn:EventBasedGateway':
            width = 50;
            height = 50;
            break;
        case 'bpmn:Task':
        case 'bpmn:UserTask':
            width = 160;
            height = 80;
            break;
        case 'bpmn:ServiceTask':
        case 'bpmn:ScriptTask':
        case 'bpmn:BusinessRuleTask':
        case 'bpmn:SendTask':
        case 'bpmn:ReceiveTask':
        case 'bpmn:ManualTask':
            width = 100;
            height = 80;
            break;
        case 'bpmn:SubProcess':
            width = 350;
            height = 200;
            break;
        default:
            width = 100;
            height = 80;
    }
    return { id: element.id, width, height, children: [], edges: [] };
}
function createElkEdge(sequenceFlow) {
    if (!sequenceFlow.sourceRef || !sequenceFlow.targetRef) {
        console.warn(`Sequence flow ${sequenceFlow.id} missing source or target reference`);
        return null;
    }
    return {
        id: sequenceFlow.id,
        sources: [sequenceFlow.sourceRef.id || sequenceFlow.sourceRef],
        targets: [sequenceFlow.targetRef.id || sequenceFlow.targetRef]
    };
}
function createMessageFlowEdge(messageFlow) {
    if (!messageFlow.sourceRef || !messageFlow.targetRef) {
        console.warn(`Message flow ${messageFlow.id} missing source or target reference`);
        return null;
    }
    return {
        id: messageFlow.id,
        sources: [messageFlow.sourceRef.id || messageFlow.sourceRef],
        targets: [messageFlow.targetRef.id || messageFlow.targetRef]
    };
}
export async function createBpmnWithLayout(originalXml, elkGraph) {
    const moddle = new BpmnModdle();
    try {
        const { rootElement: definitions } = await moddle.fromXML(originalXml);
        if (!definitions.diagrams) {
            definitions.diagrams = [];
        }
        let diagram = definitions.diagrams[0];
        if (!diagram) {
            diagram = moddle.create('bpmndi:BPMNDiagram', { id: 'BPMNDiagram_1' });
            definitions.diagrams.push(diagram);
        }
        if (!diagram.plane) {
            diagram.plane = moddle.create('bpmndi:BPMNPlane', {
                id: 'BPMNPlane_1',
                bpmnElement: findProcessOrCollaboration(definitions)
            });
        }
        diagram.plane.planeElement = [];
        processElkLayoutForDiagram(elkGraph, diagram.plane, moddle);
        const { xml: resultXml } = await moddle.toXML(definitions);
        return resultXml;
    }
    catch (error) {
        console.error('Error creating BPMN with layout:', error);
        throw new Error(`Failed to create BPMN with layout: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}
function findProcessOrCollaboration(definitions) {
    if (definitions.rootElements) {
        for (const rootElement of definitions.rootElements) {
            if (rootElement.$type === 'bpmn:Process' || rootElement.$type === 'bpmn:Collaboration') {
                return rootElement;
            }
        }
    }
    return null;
}
function processElkLayoutForDiagram(elkNode, plane, moddle, parentOffset) {
    const offset = parentOffset || { x: 0, y: 0 };
    if (elkNode.children) {
        for (const child of elkNode.children) {
            createBpmnShape(child, plane, moddle, offset);
            if (child.id.includes('Participant') && child.children && child.children.length > 0) {
                const childOffset = {
                    x: (child.x || 0) + offset.x,
                    y: (child.y || 0) + offset.y
                };
                processElkLayoutForDiagram(child, plane, moddle, childOffset);
            }
            else if (child.children && child.children.length > 0) {
                processElkLayoutForDiagram(child, plane, moddle, offset);
            }
        }
    }
    if (elkNode.edges) {
        for (const edge of elkNode.edges) {
            createBpmnEdge(edge, plane, moddle, offset);
        }
    }
}
function createBpmnShape(elkNode, plane, moddle, parentOffset) {
    const offset = parentOffset || { x: 0, y: 0 };
    let x = elkNode.x || 0;
    let y = elkNode.y || 0;
    if (!elkNode.id.includes('Participant')) {
        x += offset.x;
        y += offset.y;
    }
    const bounds = moddle.create('dc:Bounds', {
        x, y, width: elkNode.width || 100, height: elkNode.height || 80
    });
    const shape = moddle.create('bpmndi:BPMNShape', {
        id: `${elkNode.id}_di`,
        bpmnElement: { id: elkNode.id },
        bounds
    });
    plane.planeElement.push(shape);
}
function createBpmnEdge(elkEdge, plane, moddle, parentOffset) {
    const offset = parentOffset || { x: 0, y: 0 };
    const waypoints = [];
    if (elkEdge.sections && elkEdge.sections.length > 0) {
        const section = elkEdge.sections[0];
        if (section.startPoint) {
            waypoints.push(moddle.create('dc:Point', { x: section.startPoint.x + offset.x, y: section.startPoint.y + offset.y }));
        }
        if (section.bendPoints) {
            for (const bendPoint of section.bendPoints) {
                waypoints.push(moddle.create('dc:Point', { x: bendPoint.x + offset.x, y: bendPoint.y + offset.y }));
            }
        }
        if (section.endPoint) {
            waypoints.push(moddle.create('dc:Point', { x: section.endPoint.x + offset.x, y: section.endPoint.y + offset.y }));
        }
    }
    else {
        waypoints.push(moddle.create('dc:Point', { x: offset.x, y: offset.y }));
        waypoints.push(moddle.create('dc:Point', { x: 100 + offset.x, y: offset.y }));
    }
    const edge = moddle.create('bpmndi:BPMNEdge', {
        id: `${elkEdge.id}_di`,
        bpmnElement: { id: elkEdge.id },
        waypoint: waypoints
    });
    plane.planeElement.push(edge);
}
export async function generateLayout(bpmnXml) {
    const elkGraph = await transformBpmnToElk(bpmnXml);
    return await createBpmnWithLayout(bpmnXml, elkGraph);
}
