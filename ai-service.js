import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import Groq from "groq-sdk";
import OpenAI from 'openai';
const PROMPT_FILES = {
    BLANK: './blank_manipulation.prompt',
    XML: './xml_manipulation.prompt'
};
const USER_PROMPTS = {
    BLANK: (userQuery) => `
User Query: "${userQuery}"

Please analyze this query and respond appropriately.  
If the user is asking a QUESTION about BPMN, provide a helpful answer.  
If the user wants to CREATE a new process flow, generate a complete BPMN 2.0 XML document based on the official documentation https://camunda.com/bpmn/reference/.  

INSTRUCTION:  
- You must always begin the response with the standard XML and namespace declarations.  
- Always include Task Markers when applicable.  
- Always add the XML declaration first:  
  <?xml version="1.0" encoding="UTF-8"?>  
- The <bpmn:definitions> element must contain a unique id derived from the user's query, for example: id="Definitions_HotelBooking_001".  
- Standard required namespaces:  
  <bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"  
                     xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"  
                     xmlns:omgdi="http://www.omg.org/spec/DD/20100524/DI"  
                     xmlns:omgdc="http://www.omg.org/spec/DD/20100524/DC"  
                     xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"  
                     targetNamespace="http://bpmn.io/bpmn"  
                     id="Definitions_{uniqueId}">  

- IMPORTANT: When generating BPMN workflows, ensure that every sequence flow exiting a gateway (exclusive, inclusive, event-based, or parallel) contains a meaningful label.  
  * Either set the name attribute directly (e.g., name="Approved")  
  * Or include a <bpmn:conditionExpression xsi:type="bpmn:tFormalExpression">approved</bpmn:conditionExpression>  
  * Do not leave any outgoing gateway flow unlabeled.  
- IMPORTANT: 
  * Always use lowercase tag names with the bpmn: prefix, for example: <bpmn:userTask>, <bpmn:serviceTask>, <bpmn:manualTask>.  
  * Never use camelCase or PascalCase (e.g., <bpmn:UserTask>) because it will cause parsing errors.  
  * Ensure the <bpmn:definitions> element includes the xmlns:bpmn namespace declaration so all task types are recognized.  
  * Apply the same rule for scriptTask, manualTask, sendTask, receiveTask, businessRuleTask, callActivity, etc.  
- When creating <bpmn:messageFlow> elements, you must always ensure that both sourceRef and targetRef reference valid, existing element IDs in different participants.  
- Never leave sourceRef or targetRef as null, empty, or undefined.  
- If either source or target is missing, do not generate the message flow until both references are available.  
- When creating <bpmn:sequenceFlow> elements, always ensure that both sourceRef and targetRef reference valid, existing element IDs.  
- Never leave sourceRef or targetRef as null, empty, or undefined.  
- If either source or target is missing, do not generate the sequence flow until both references are available.  
- When the process logic requires waiting for a duration or a deadline, include <bpmn:timerEventDefinition>.  
- Use <bpmn:intermediateCatchEvent> with a timer when waiting is required.  
- Use <bpmn:boundaryEvent> with a <bpmn:timerEventDefinition> attached to a task when a timeout or deadline can interrupt the task.  
- Always provide meaningful attributes for timers (e.g., <bpmn:timeDuration>, <bpmn:timeDate>, or <bpmn:timeCycle>).  
- ALWAYS ensure that all tasks are properly connected with sequence flows or message flows. It is strictly forbidden to leave any task, event, or participant unconnected. Every element in the process must be part of a valid, continuous flow.
- ALWAYS ensure that all pools / participants are properly connected with sequence flows or message flows. It is strictly forbidden to leave any task, event, or participant unconnected. Every element in the process must be part of a valid, continuous flow.

**GLOBAL TASK NUMBERING:**  
- Each task in the generated BPMN must be **numbered sequentially across all participants (pools)** according to its true **logical execution order**.  
- The numbering should **not restart per pool** — it must continue globally through the entire collaboration diagram.  
- The numbering should appear **at the beginning of each task name** in the format:  
  **"1. Task Name"**, **"2. Next Task"**, **"3. Next Task"**, etc.  
- The sequence must reflect the **end-to-end process flow**, even if the execution passes through different pools via **message flows**.  
- Example of correct cross-pool numbering:  
  - HR Department:  
    \`1. Review Application\`  
    \`2. Send Offer\`  
  - Hiring Manager:  
    \`3. Prepare Onboarding\`  
- Ensure numbering is **continuous and unique** across all pools in the same process.  
- Do **not** modify task IDs — only prefix the numbering in the \`name\` attribute.  
- If a task in another pool logically occurs *after* a task in a different pool (connected via message flow), it must receive the **next available number**, continuing the same sequence.  
- When the flow branches or merges (gateways), assign numbers in the **most natural or dominant execution order**, but ensure all paths use unique and continuous numbering.  
- Example:  
  \`\`\`xml
  <bpmn:userTask id="Task_Review" name="1. Review Application"/>  
  <bpmn:serviceTask id="Task_SendOffer" name="2. Send Offer"/>  
  <bpmn:userTask id="Task_PrepareOnboarding" name="3. Prepare Onboarding"/>  
  \`\`\` 



RESPONSE FORMAT (always respond with a strict JSON object, no explanations, no markdown):  

{
  "type": "question" | "creation",
  "content": "string"
}

`,
    XML: (userQuery, xml) => `
Analyze the following user query and BPMN XML, then respond appropriately.

User Query: "${userQuery}"

BPMN 2.0 XML:
${xml}

INSTRUCTIONS:
- If the query is a MODIFICATION request: Generate the exact sequence of function calls needed to perform the modification based on this official documentation https://camunda.com/bpmn/reference/.
- If the query is a QUESTION about BPMN 2.0: Provide a helpful answer explaining the BPMN concepts or XML structure.
- Always include Task Markers when applicable.
- Always ensure gateway sequence flows are labeled meaningfully.
- When replacing name of task: Use replaceTask function to replace only the name of the task (attribute name) and keep all its connected flows fixed without modifying or removing them. 
- When removing messageFlow : Use removeMessageFlow function
- When removing sequenceFlow: Use removeSequenceFlow function
- When removing tasks: Use removeTask function to remove the task and all its connected flows, then create new sequence flows to reconnect any elements that need to remain connected.  
- When replacing tasks: Use replaceTask function to replace the task and keep all its connected flows fixed without modifying or removing them. 
- When creating <bpmn:messageFlow> elements, you must always ensure that both sourceRef and targetRef reference valid, existing element IDs in different participants.  
- Never leave sourceRef or targetRef as null, empty, or undefined.  
- If either source or target is missing, do not generate the message flow until both references are available.  
- When creating <bpmn:sequenceFlow> elements, always ensure that both sourceRef and targetRef reference valid, existing element IDs.  
- Never leave sourceRef or targetRef as null, empty, or undefined.  
- If either source or target is missing, do not generate the sequence flow until both references are available. 
- When the process logic requires waiting for a duration or a deadline, include <bpmn:timerEventDefinition>.  
- Use <bpmn:intermediateCatchEvent> with a timer when waiting is required.  
- Use <bpmn:boundaryEvent> with a <bpmn:timerEventDefinition> attached to a task when a timeout or deadline can interrupt the task.  
- Always provide meaningful attributes for timers (e.g., <bpmn:timeDuration>, <bpmn:timeDate>, or <bpmn:timeCycle>).
- When replacing tasks, always use the standard task type/marker <bpmn:Task> (not one of : userTask, serviceTask, manualTask, scriptTask, etc.).  
- When replacing a task that is connected to other participants via message flows (<bpmn:messageFlow> and <bpmndi:BPMNEdge>):  
  * Before deleting the old task, capture all message flows (incoming and outgoing) connected to it.  
  * Update each message flow's sourceRef/targetRef to point to the new replacement task ID.  
  * Only after rebinding all message flows should the old task be removed from the XML.  
  * Preserve all attributes of the message flow (id, name, labels, documentation, etc.).  
  * Never generate a message flow with null/undefined sourceRef or targetRef.  
  * After replacement, validate that every message flow points to valid, existing elements in different participants.  

  *Example:**  
  - Original:  
    xml
    <bpmn:userTask id="Task_SendInvoice" name="Send Invoice"/>  
    <bpmn:userTask id="Task_ReceiveInvoice" name="Receive Invoice"/>  

    <bpmn:messageFlow id="MessageFlow_Invoice" name="Invoice Sent"  
                      sourceRef="Task_SendInvoice" targetRef="Task_ReceiveInvoice"/>  

    <bpmndi:BPMNEdge id="BPMNEdge_MessageFlow_Invoice" bpmnElement="MessageFlow_Invoice">  
      <omgdi:waypoint x="200" y="100"/>  
      <omgdi:waypoint x="400" y="100"/>  
    </bpmndi:BPMNEdge>  
      

  - Replacement: Replace Task_SendInvoice with Task_EmailInvoice.  
    xml
    <bpmn:userTask id="Task_EmailInvoice" name="Email Invoice"/>  
    <bpmn:userTask id="Task_ReceiveInvoice" name="Receive Invoice"/>  

    <bpmn:messageFlow id="MessageFlow_Invoice" name="Invoice Sent"  
                      sourceRef="Task_EmailInvoice" targetRef="Task_ReceiveInvoice"/>  

    <bpmndi:BPMNEdge id="BPMNEdge_MessageFlow_Invoice" bpmnElement="MessageFlow_Invoice">  
      <omgdi:waypoint x="220" y="120"/>  
      <omgdi:waypoint x="420" y="120"/>  
    </bpmndi:BPMNEdge>  
      

  ✅ The message flow ID and label (MessageFlow_Invoice / "Invoice Sent") remain the same.  
  ✅ The BPMNEdge is preserved and still references the correct bpmn:messageFlow.  
  ✅ Only the 'sourceRef' of the message flow was updated to point to the new task. 

**GLOBAL TASK NUMBERING:**  
- When updating or modifying BPMN XML, ensure that task numbering remains **global and continuous across all pools** according to logical execution order.  
- If new tasks are added, insert their numbering based on where they occur in the process flow, continuing the same global sequence.  
- Numbering must **not restart per participant**.  
- Do not change task IDs; only modify the \`name\` attribute to reflect numbering.  
- Example (cross-pool numbering):  
  \`\`\`xml
  <bpmn:userTask id="Task_Review" name="1. Review Application"/>  
  <bpmn:serviceTask id="Task_SendOffer" name="2. Send Offer"/>  
  <bpmn:userTask id="Task_PrepareOnboarding" name="3. Prepare Onboarding"/>  
  \`\`\`  



RESPONSE FORMAT (always respond with a strict JSON object, no explanations, no markdown):

{
  "type": "question" | "modification",
  "content": string | string[]
}

- For questions: "type" = "question", "content" = helpful answer string.
- For modifications: "type" = "modification", "content" = array of function call strings (e.g., ["create|bpmn:Task|{\"id\":\"Task_New\"}", ...]).
`
};
function initGroqClient(token) {
    if (!token) {
        throw new Error('GROQ_API_KEY is not set in environment variables');
    }
    try {
        const groq = new Groq({
            apiKey: token,
        });
        return groq;
    }
    catch (e) {
        console.error(`Error in initGroqClient: ${e.message}`);
        throw e;
    }
}
function initOpenAIClient(apiKey) {
    if (!apiKey) {
        throw new Error('OPENAI_API_KEY is not set in environment variables');
    }
    try {
        return new OpenAI({ apiKey: apiKey });
    }
    catch (e) {
        console.error(`Error in initOpenAIClient: ${e.message}`);
        throw e;
    }
}
const groq_client = initGroqClient(process.env.GROQ_API_KEY);
const openai = initOpenAIClient(process.env.OPENAI_API_KEY);

/**
 * Generate embedding vector for text using OpenAI embeddings API
 * @param {string} text - Text to generate embedding for
 * @returns {Promise<number[]>} - Embedding vector (1536 dimensions for text-embedding-3-small)
 */
export async function getEmbedding(text) {
    try {
        if (!text || !text.trim()) {
            // Return zero vector if text is empty
            return new Array(1536).fill(0);
        }
        
        const res = await openai.embeddings.create({
            model: "text-embedding-3-small",
            input: text.trim()
        });
        
        return res.data[0].embedding;
    } catch (error) {
        console.error('Error generating embedding:', error);
        // Return zero vector on error
        return new Array(1536).fill(0);
    }
}

/**
 * Extract text description from an image using vision model
 * @param {string} imageBase64 - Base64 encoded image
 * @returns {Promise<string>} - Text description of the image
 */
export async function extractTextFromImage(imageBase64) {
    try {
        if (!imageBase64) {
            return '';
        }

        let cleanBase64 = imageBase64;
        if (imageBase64.includes(',')) {
            cleanBase64 = imageBase64.split(',')[1];
        }
        
        if (!cleanBase64 || cleanBase64.trim().length === 0) {
            throw new Error('Invalid base64 string: empty or whitespace only');
        }

        const systemPrompt = `You are an expert at analyzing BPMN diagrams and process flow images. 
                                Describe what you see in the image in detail, including:
                                - The type of process or workflow (e.g., hiring, order processing, approval)
                                - Key steps, tasks, or activities shown
                                - Decision points or gateways
                                - Flow direction and connections
                                - Any text labels or annotations
                                - The overall business process being represented

                                Provide a clear, detailed description that would help someone understand the process without seeing the image.`;

        const userPrompt = `Analyze this image and describe the BPMN diagram or process flow you see. 
                            Focus on the business process, tasks, and workflow structure.`;

        /** @type {Array<{type: "text", text: string} | {type: "image_url", image_url: {url: string}}>} */
        const userContent = [
            {
                "type": "text",
                "text": userPrompt
            },
            {
                "type": "image_url",
                "image_url": {
                    "url": `data:image/jpeg;base64,${cleanBase64}`
                }
            }
        ];

        const response = await groq_client.chat.completions.create({
            messages: [
                {
                    role: "system",
                    content: systemPrompt,
                },
                {
                    role: "user",
                    content: userContent,
                },
            ],
            model: "meta-llama/llama-4-maverick-17b-128e-instruct",
        });

        const description = response.choices[0]?.message?.content || '';
        return description.trim();
    } catch (error) {
        console.error('Error extracting text from image:', error);
        return '';
    }
}

export async function execute(xml, userQuery) {
    try {
        const result = await analyzeAndGenerateResponse(xml, userQuery);
        return result;
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        throw new Error(`AI Service Error: ${errorMessage}`);
    }
}
function isXmlEmptyOrWithoutTasks(xml) {
    if (!xml || xml.trim() === '') {
        return true;
    }
    const blankTemplate = '<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn" exporter="bpmn-js (https://demo.bpmn.io)" exporterVersion="9.0.3"><bpmndi:BPMNDiagram id="BPMNDiagram_1"><bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Process_1"><bpmndi:BPMNShape id="_BPMNShape_StartEvent_2" bpmnElement="StartEvent_1"><dc:Bounds height="36.0" width="36.0" x="412.0" y="240.0"/></bpmndi:BPMNShape></bpmndi:BPMNPlane></bpmndi:BPMNDiagram></bpmn:definitions>';
    if (xml.trim() === blankTemplate) {
        return true;
    }
    const taskPatterns = [
        /<bpmn:task\s/i,
        /<bpmn:userTask\s/i,
        /<bpmn:serviceTask\s/i,
        /<bpmn:scriptTask\s/i,
        /<bpmn:manualTask\s/i,
        /<bpmn:businessRuleTask\s/i,
        /<bpmn:sendTask\s/i,
        /<bpmn:receiveTask\s/i,
        /<bpmn:subProcess\s/i,
        /<bpmn:callActivity\s/i
    ];
    const hasTasks = taskPatterns.some(pattern => pattern.test(xml));
    return !hasTasks;
}
async function analyzeAndGenerateResponse(xml, userQuery) {
    const isEmptyXml = isXmlEmptyOrWithoutTasks(xml);
    const promptFileName = isEmptyXml ? PROMPT_FILES.BLANK : PROMPT_FILES.XML;
    const currentDir = typeof __dirname !== 'undefined' ? __dirname : path.resolve(process.cwd(), 'src/api/services');
    const systemPromptPath = path.join(currentDir, promptFileName);
    const systemPrompt = fs.readFileSync(systemPromptPath, 'utf-8');

    const userPrompt = isEmptyXml
        ? USER_PROMPTS.BLANK(userQuery)
        : USER_PROMPTS.XML(userQuery, xml);
    const start = Date.now();

    const response = await groq_client.chat.completions.create({
        messages: [
            {
                role: "system",
                content: systemPrompt,
            },
            {
                role: "user",
                content: userPrompt,
            },
        ],
        model: "openai/gpt-oss-120b",
    });
    const end = Date.now();
    const durationMs = end - start;
    let content = response.choices[0]?.message?.content || "";
    content = extractJsonFromMarkdown(content);
    let parsed;
    try {
        parsed = JSON.parse(content);
    }
    catch (e) {
        throw new Error('AI did not return valid JSON: ' + content);
    }
    //// --- Data Collection for Fine-Tuning ---
    //// Create the JSONL entry
    //const jsonlEntry = {
    //    messages: [
    //       { role: "user", content: userQuery },
    //        { role: "assistant", content: JSON.stringify(parsed) } // Stringify the ProcessResult
    //    ]
    //};
    // Append the entry to the JSONL file
    //try {
    //fs.appendFileSync(TRAINING_DATA_FILE, JSON.stringify(jsonlEntry) + '\n');
    //} catch (writeError) {
    //console.error('Error writing training data to file:', writeError);
    //// Optionally, you might want to throw this error or handle it differently
    //// throw writeError;
    //}
    //// --- End of Data Collection ---
    return parsed;
}
export async function generateTitleAndDepartment(userQuery) {
    const parts = [];
    parts.push(userQuery);
   
    const context = parts.join('');
    const systemPrompt = `You are a workflow categorization expert. Based on the request and any provided context (document text and/or BPMN XML), output exactly two lines:
Line 1: A short, professional BPMN workflow title (3–6 words).
Line 2: The most relevant department (e.g., HR, Finance, IT, Sales, Legal, Operations, Procurement, Customer Support).

Do not add any other text, explanations, or formatting.`;
    const userPrompt = `Process this input:\n${context}`;
    try {
        const response = await groq_client.chat.completions.create({
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt },
            ],
            model: "openai/gpt-oss-120b",
        });
        const output = response.choices[0]?.message?.content?.trim() || '';
        const lines = output.split('\n').map(l => l.trim());
        let title = lines[0]?.replace(/^['"]|['"]$/g, '') || userQuery.substring(0, 60);
        let department = lines[1]?.replace(/^['"]|['"]$/g, '') || 'General';
        const validDepts = ['HR', 'Finance', 'IT', 'Sales', 'Legal', 'Operations', 'Procurement', 'Customer Support', 'Marketing', 'General'];
        if (!validDepts.some(d => department.toLowerCase() === d.toLowerCase())) {
            department = 'General';
        }
        return { title, department };
    }
    catch (error) {
        console.error('Failed to generate title/department with Groq');
        return {
            title: userQuery.substring(0, 60).trim(),
            department: 'General'
        };
    }
}
function extractJsonFromMarkdown(content) {
    if (content.includes('```json')) {
        const match = content.match(/```json\s*([\s\S]*?)\s*```/);
        if (match)
            return match[1];
    }
    else if (content.includes('```')) {
        const match = content.match(/```\s*([\s\S]*?)\s*```/);
        if (match)
            return match[1];
    }
    return content;
}
export async function transcribeAudio(audioBuffer, fileExtension = 'webm') {
    let tempFilePath = null;
    
    try {
        const tempDir = os.tmpdir();
        tempFilePath = path.join(tempDir, `bpmn_audio_${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExtension}`);
        
        fs.writeFileSync(tempFilePath, audioBuffer);
        
        const transcription = await groq_client.audio.transcriptions.create({
            file: fs.createReadStream(tempFilePath),
            model: "whisper-large-v3-turbo",
            prompt: "This is a voice message for BPMN process creation or modification",
            response_format: "verbose_json",
            timestamp_granularities: ["word", "segment"],
            language: "en",
            temperature: 0.0,
        });
        
        if (tempFilePath && fs.existsSync(tempFilePath)) {
            try {
                fs.unlinkSync(tempFilePath);
            } catch (unlinkError) {
                console.warn('Failed to delete temp file after transcription:', unlinkError);
            }
        }
        
        return transcription.text || '';
    }
    catch (error) {
        console.error('Error transcribing audio:', error);
        if (tempFilePath && fs.existsSync(tempFilePath)) {
            try {
                fs.unlinkSync(tempFilePath);
            } catch (unlinkError) {
                console.warn('Failed to delete temp file on error:', unlinkError);
            }
        }
        throw new Error(`Audio transcription failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}
export async function generateWorkflowDescription(xml) {
    const prompt = `
    You are a BPMN process analyst. Based on the following information, generate a detailed, professional, and structured description of the business process.

    BPMN 2.0 XML:
    ${xml}

    INSTRUCTIONS:
    - Describe the process in clear, natural language for non-technical readers.
    - Identify the start event, tasks, decision points (gateways), and end event.
    - Explain the flow logic, including conditions on sequence flows.
    - Highlight key activities, their purpose, handoffs, and interactions between roles.
    - If the process is derived from a document, explain how it maps to the source (cite section/page if available).
    - Where details are missing, make reasonable, clearly labeled assumptions (e.g., "Assumption:").
    - Keep terms business-friendly; do NOT include raw XML or technical tags like "bpmn:task".
    - At the very beginning of your response, generate a single line "Report Title: <TITLE>" where <TITLE> is a short descriptive title for the process (e.g., "Hiring Process Analysis Report"). Use plain text only.


    SECTIONS TO PRODUCE (IN ORDER):Overview
        - One short paragraph summarizing the business objective, scope, and triggers.
    Process Boundaries and Scope
        - Define what is included and excluded from the process.
        - Mention subprocesses or external systems involved.
        - Note activities that are out of scope but may appear related.
    Process Flow
        - Step-by-step narrative of the sequence from start to end, describing what happens and why.
    Key Decision Points
        - List each decision (gateway) and enumerate the outgoing paths with their conditions.
    Roles and Responsibilities (Table)
        - Provide a plain-text table using pipes (|) with columns exactly:
        Role | Responsibilities
        - Each role appears once with concise, action-oriented responsibilities.
    Step-by-Step Specification (Table)
        - Provide a plain-text table using pipes (|) with columns exactly:
        Step No. | Step | Step Description | Executed by | Service Level Agreement | Input | Output
        - Include every meaningful step in execution order. If a value is unknown, write "N/A".
        - For "Executed by", use a role name (not a person's name).
        - For SLA, state a measurable target if present (e.g., "Within 2 business days"); otherwise "N/A".
    Business Rules and Constraints
        - List any business rules referenced in gateways or tasks.
        - Include compliance or regulatory constraints if applicable.
        - If known, cite sources like policy documents or standards.
    Data and Information Flow
        - Identify key data objects used or produced at each step.
        - Describe inputs/outputs and their sources (e.g., forms, databases).
        - Mention integration points or handoffs where data is exchanged between roles or systems.
    Risks and Controls
        - Identify process risks (e.g., delays, errors, compliance breaches).
        - Suggest controls or checks already built into the process.
        - Recommend improvements if obvious gaps exist.

    Performance Indicators (KPIs)
        - List relevant KPIs tied to process outcomes (e.g., cycle time, error rate, approval rate).
        - State targets or benchmarks if available.
        - Explain how these metrics align with business goals.

    Assumptions and Dependencies
        - Explicitly list assumptions made during analysis.
        - Identify dependencies on other processes, systems, or teams.
        - Note any environmental or organizational conditions assumed to hold true.

    Variants and Exception Handling
        - Describe alternative paths for exceptions or special cases.
        - Mention error handling or escalation procedures.
        - Reference any retry mechanisms or fallback processes.

    Technology and System Involvement
        - Identify which tools, applications, or platforms support specific steps.
        - Mention integrations (e.g., CRM, ERP, email systems).
        - Describe human vs automated steps clearly.

    Process Outcome
        - Describe end states, success criteria, and business value delivered.

    FORMATTING RULES:
    - RESPONSE FORMAT: Return only plain text (no JSON, no markdown). Use line breaks for readability.
    - For the two tables, render as plain-text tables with pipes (|) and a single header row. Do not include code fences in your output.
    - Keep sentences concise and unambiguous. Avoid bullet characters; use numbered steps in the narrative when helpful.
    - Do not use special characters that may get corrupted in PDF (e.g., →, ≥, non-breaking hyphens, curly quotes, etc.).
    - Instead, always replace them with plain text alternatives:
            Use -> instead of →
            Use >= instead of ≥
            Use a normal hyphen - instead of non-breaking or long dashes
            Use straight quotes " and apostrophes ' instead of curly ones

    QUALITY CHECK BEFORE FINALIZING:
    - Are start and end events explicitly named?
    - Are all gateways covered with clear conditions?
    - Do tables include all columns exactly as specified, with "N/A" where data is unavailable?
    - Are assumptions clearly labeled and minimal?
    - Are all new sections included and properly populated where information exists?
    `;
    try {
        const response = await openai.chat.completions.create({
            messages: [{ role: 'user', content: prompt }],
            model: 'chatgpt-4o-latest',
            temperature: 0.1,
        });
        return response.choices[0]?.message?.content?.trim() || 'No description generated.';
    }
    catch (error) {
        console.error('LLM error in generateWorkflowDescription:', error);
        return 'The process description could not be generated.';
    }
}
