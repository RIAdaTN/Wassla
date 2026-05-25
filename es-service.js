import { Client } from '@elastic/elasticsearch';


export const WORKFLOWS_INDEX = 'bpmn_workflows';
const EMBEDDING_DIMENSION = 1536; // OpenAI text-embedding-3-small dimension

export async function initWorkflowIndex() {
    const exists = await esClient.indices.exists({ index: WORKFLOWS_INDEX });
    if (!exists) {
        await esClient.indices.create({
            index: WORKFLOWS_INDEX,
            mappings: {
                properties: {
                    id: { type: 'keyword' },
                    title: { type: 'text', analyzer: 'english' },
                    department: { type: 'keyword' },
                    user_query: { type: 'text', analyzer: 'english' },
                    xml: { type: 'text', analyzer: 'whitespace' },
                    session_id: { type: 'keyword' },
                    created_at: { type: 'date' },
                    updated_at: { type: 'date' },
                    pdf_text: { type: 'text', analyzer: 'english' },
                    image_text: { type: 'text', analyzer: 'english' },
                    audio_text: { type: 'text', analyzer: 'english' },
                    // Dense vector field for semantic search
                    embedding: {
                        type: 'dense_vector',
                        dims: EMBEDDING_DIMENSION,
                        index: true,
                        similarity: 'cosine'
                    }
                }
            }
        });
    } else {
        // Check if new fields exist, if not, update mapping
        try {
            const mapping = await esClient.indices.getMapping({ index: WORKFLOWS_INDEX });
            const properties = mapping[WORKFLOWS_INDEX]?.mappings?.properties;
            
            const fieldsToAdd = {};
            
            if (!properties?.embedding) {
                fieldsToAdd.embedding = {
                    type: 'dense_vector',
                    dims: EMBEDDING_DIMENSION,
                    index: true,
                    similarity: 'cosine'
                };
            }
            
            if (!properties?.pdf_text) {
                fieldsToAdd.pdf_text = { type: 'text', analyzer: 'english' };
            }
            
            if (!properties?.image_text) {
                fieldsToAdd.image_text = { type: 'text', analyzer: 'english' };
            }
            
            if (!properties?.audio_text) {
                fieldsToAdd.audio_text = { type: 'text', analyzer: 'english' };
            }
            
            if (Object.keys(fieldsToAdd).length > 0) {
                await esClient.indices.putMapping({
                    index: WORKFLOWS_INDEX,
                    // @ts-ignore - Elasticsearch mapping properties type
                    properties: fieldsToAdd
                });
            }
        } catch (err) {
            console.warn('Could not update index mapping (may need manual update):', err.message);
        }
    }
}
export async function indexWorkflow(workflow) {
    try {
        const document = {
            id: workflow.id.toString(),
            title: workflow.title,
            department: workflow.department,
            user_query: workflow.user_query,
            xml: workflow.xml,
            session_id: workflow.session_id,
            created_at: workflow.created_at,
            updated_at: workflow.updated_at,
            // Include extracted text fields for better search
            pdf_text: workflow.pdf_text || null,
            image_text: workflow.image_text || null,
            audio_text: workflow.audio_text || null
        };
        
        // Add embedding if provided
        if (workflow.embedding && Array.isArray(workflow.embedding)) {
            document.embedding = workflow.embedding;
        }
        
        await esClient.index({
            index: WORKFLOWS_INDEX,
            id: workflow.id.toString(),
            document: document,
            refresh: true
        });
    }
    catch (err) {
        console.error('Failed to index workflow in Elasticsearch:', err.message || err);
        if (err.meta?.body) {
            console.error('ES Error details:', JSON.stringify(err.meta.body, null, 2));
        }
    }
}
export async function searchWorkflows(query, department) {
    /** @type {Array<{multi_match: any} | {term: any}>} */
    const mustClauses = [
        {
            multi_match: {
                query,
                fields: ['title^3', 'user_query^2', 'xml'],
                type: 'best_fields',
                fuzziness: 'AUTO'
            }
        }
    ];
    if (department) {
        mustClauses.push({ term: { department } });
    }
    const result = await esClient.search({
        index: WORKFLOWS_INDEX,
        query: { bool: { must: mustClauses } },
        sort: [{ updated_at: { order: 'desc' } }],
        size: 10
    });
    return result.hits.hits.map((hit) => hit._source);
}

/**
 * Search for similar workflows using hybrid search (vector kNN + BM25 text search)
 * @param {string} query - The search query (can include PDF text, audio transcription, image text, etc.)
 * @param {string} [department] - Optional department filter
 * @param {number} [minScore=0.75] - Minimum similarity score threshold (0-1)
 * @param {number} [maxResults=5] - Maximum number of results to return
 * @param {number[]} [queryEmbedding] - Optional pre-computed query embedding vector
 * @returns {Promise<Array<{workflow: any, score: number}>>} - Array of workflows with their similarity scores
 */
export async function searchSimilarWorkflows(query, department, minScore = 0.75, maxResults = 5, queryEmbedding = null) {
    try {
        let searchQuery = query;
                searchQuery = searchQuery
            .replace(/--- Extracted PDF Content ---/g, '')
            .replace(/--- Audio Transcription ---/g, '')
            .replace(/--- Extracted Image Content ---/g, '')
            .trim();
        
    
        // Build BM25 text search query        
        /** @type {Array<any>} */
        const textSearchClauses = [
            {
                multi_match: {
                    query: searchQuery,
                    fields: [
                        'title^3', 
                        'user_query^2', 
                        'pdf_text^2', 
                        'image_text^2', 
                        'audio_text^2', 
                        'xml^1'
                    ],
                    type: 'best_fields',
                    fuzziness: 'AUTO',
                    boost: 1.0
                }
            },
            {
                match: {
                    user_query: {
                        query: searchQuery,
                        boost: 2.0,
                        fuzziness: 'AUTO'
                    }
                }
            },
            {
                match: {
                    title: {
                        query: searchQuery,
                        boost: 3.0,
                        fuzziness: 'AUTO'
                    }
                }
            },
            {
                match: {
                    pdf_text: {
                        query: searchQuery,
                        boost: 2.0,
                        fuzziness: 'AUTO'
                    }
                }
            },
            {
                match: {
                    image_text: {
                        query: searchQuery,
                        boost: 2.0,
                        fuzziness: 'AUTO'
                    }
                }
            },
            {
                match: {
                    audio_text: {
                        query: searchQuery,
                        boost: 2.0,
                        fuzziness: 'AUTO'
                    }
                }
            }
        ];

        // Build hybrid search query
        const searchBody = {
            size: maxResults
        };

        // Build BM25 query
        const boolQuery = {
            should: textSearchClauses,
            minimum_should_match: 1
        };

        // Add department filter if provided
        if (department) {
            boolQuery.must = [{ term: { department } }];
        }

        searchBody.query = {
            bool: boolQuery
        };

        // Add vector kNN search if embedding is provided
        if (queryEmbedding && Array.isArray(queryEmbedding) && queryEmbedding.length === EMBEDDING_DIMENSION) {
            searchBody.knn = {
                field: 'embedding',
                query_vector: queryEmbedding,
                k: maxResults,
                num_candidates: maxResults * 10,
                boost: 0.6 
            };
            
            // Add department filter to kNN as well
            if (department) {
                searchBody.knn.filter = {
                    term: { department }
                };
            }

        }

        const result = await esClient.search({
            index: WORKFLOWS_INDEX,
            ...searchBody
        });

        // Normalize scores to 0-1 range using max score directly to preserve relative rankings
        let normalizationFactor = 15.0; 
        if (result.hits.hits.length > 0) {
            const maxRawScore = Math.max(...result.hits.hits.map(h => h._score));
            // Use max score directly to preserve relative differences between results
            // This ensures high-scoring results maintain their relative positions
            if (queryEmbedding) {
                // For hybrid search, use max score directly (top result becomes 1.0)
                normalizationFactor = Math.max(maxRawScore, 20.0);
            } else {
                normalizationFactor = Math.max(maxRawScore, 15.0);
            }
        }
                
        const results = result.hits.hits.map((hit) => ({
            workflow: hit._source,
            score: Math.min(hit._score / normalizationFactor, 1.0), // Normalize to 0-1
            rawScore: hit._score
        }));
        
        // Sort by score descending (highest first)
        results.sort((a, b) => b.score - a.score);
        
        // Don't filter by threshold here - let the caller decide
        // This allows checking more results even if some are orphaned
        
        return results;
    } catch (err) {
        console.error('Failed to search similar workflows in Elasticsearch:', err);
        if (err.meta?.body) {
            console.error('ES Error details:', JSON.stringify(err.meta.body, null, 2));
        }
        return [];
    }
}

/**
 * Check which workflows in Elasticsearch have embeddings
 * @returns {Promise<{withEmbeddings: number, withoutEmbeddings: number, total: number, skipped?: number}>}
 */
export async function checkEmbeddingStatus() {
    try {
        // Get all workflows from Elasticsearch
        const result = await esClient.search({
            index: WORKFLOWS_INDEX,
            query: { match_all: {} },
            size: 10000,
            _source: ['id', 'title', 'embedding']
        });
        
        let withEmbeddings = 0;
        let withoutEmbeddings = 0;
        
        result.hits.hits.forEach(hit => {
            // @ts-ignore - Elasticsearch source type is dynamic
            const source = hit._source || {};
            // @ts-ignore
            const embedding = source.embedding;
            if (embedding && Array.isArray(embedding) && embedding.length === EMBEDDING_DIMENSION) {
                withEmbeddings++;
            } else {
                withoutEmbeddings++;
            }
        });
        
        return {
            withEmbeddings,
            withoutEmbeddings,
            total: result.hits.hits.length
        };
    } catch (err) {
        console.error('Failed to check embedding status:', err);
        return { withEmbeddings: 0, withoutEmbeddings: 0, total: 0 };
    }
}

/**
 * Backfill embeddings for existing workflows in Elasticsearch
 * @param {any} strapi - Strapi instance
 * @param {Function} getEmbedding - Function to generate embeddings
 * @param {boolean} forceRegenerate - If true, regenerate embeddings even if they already exist
 * @returns {Promise<{success: number, skipped: number, errors: number, total: number, updated: number}>}
 */
export async function backfillEmbeddings(strapi, getEmbedding, forceRegenerate = false) {
    try {
        
        // Get all workflows from database with all text fields
        const workflows = await strapi.entityService.findMany('api::workflow.workflow', {
            limit: -1,
            fields: ['id', 'title', 'user_query', 'xml', 'pdf_text', 'image_text', 'audio_text']
        });
                
        let successCount = 0;
        let errorCount = 0;
        let skippedCount = 0;
        
        for (const workflow of workflows) {
            try {
                // Check if workflow exists in ES and has embedding (only if not forcing regeneration)
                if (!forceRegenerate) {
                    const esDoc = await esClient.get({
                        index: WORKFLOWS_INDEX,
                        id: workflow.id.toString()
                    }).catch(() => null);
                    
                    // @ts-ignore - Elasticsearch source type is dynamic
                    const existingEmbedding = esDoc?._source?.embedding;
                    if (existingEmbedding && Array.isArray(existingEmbedding) && existingEmbedding.length === EMBEDDING_DIMENSION) {
                        skippedCount++;
                        continue;
                    }
                }
                
                // Generate embedding for workflow using ALL available text fields
                const embeddingParts = [
                  workflow.title || '',
                  workflow.user_query || '',
                  workflow.pdf_text || '',
                  workflow.image_text || '',
                  workflow.audio_text || '',
                  (workflow.xml || '').substring(0, 2000) // Limit XML to first 2000 chars
                ].filter(part => part && part.trim()); // Remove empty parts
                
                if (embeddingParts.length === 0) {
                    console.warn(`Workflow ${workflow.id} has no text content, skipping`);
                    skippedCount++;
                    continue;
                }
                
                const workflowText = embeddingParts.join('\n\n');
                
                const embedding = await getEmbedding(workflowText);
                
                if (!embedding || !Array.isArray(embedding) || embedding.length !== EMBEDDING_DIMENSION) {
                    errorCount++;
                    continue;
                }
                
                // Update workflow in Elasticsearch with embedding and text fields
                await esClient.update({
                    index: WORKFLOWS_INDEX,
                    id: workflow.id.toString(),
                    doc: {
                        embedding: embedding,
                        // Also update text fields if they exist in DB but not in ES
                        pdf_text: workflow.pdf_text || null,
                        image_text: workflow.image_text || null,
                        audio_text: workflow.audio_text || null
                    },
                    refresh: true
                });
                
                successCount++;
                
                // Small delay to avoid rate limiting
                await new Promise(resolve => setTimeout(resolve, 100));
            } catch (err) {
                console.error(`Failed to ${forceRegenerate ? 'regenerate' : 'add'} embedding to workflow ${workflow.id}:`, err.message);
                errorCount++;
            }
        }
        
        return { success: successCount, skipped: skippedCount, errors: errorCount, total: workflows.length, updated: successCount };
    } catch (err) {
        console.error('Embedding backfill failed:', err);
        throw err;
    }
}

export async function deleteWorkflowFromIndex(workflowId) {
    try {
        await esClient.delete({
            index: WORKFLOWS_INDEX,
            id: workflowId.toString()
        });
    }
    catch (err) {
        if (err.meta?.statusCode !== 404) {
            console.error('Failed to delete workflow from index:', err.message || err);
        }
    }
}

/**
 * Clean up orphaned entries in Elasticsearch (entries that don't exist in database)
 * @param {any} strapi - Strapi instance
 * @returns {Promise<{deleted: number, total: number}>}
 */
export async function cleanupOrphanedEntries(strapi) {
    try {        
        // Get all workflow IDs from database
        const dbWorkflows = await strapi.entityService.findMany('api::workflow.workflow', {
            limit: -1,
            fields: ['id']
        });
        
        const dbWorkflowIds = new Set(dbWorkflows.map(w => w.id.toString()));
        
        // Get all workflows from Elasticsearch
        const result = await esClient.search({
            index: WORKFLOWS_INDEX,
            query: { match_all: {} },
            size: 10000,
            _source: ['id']
        });
        
        const esWorkflowIds = result.hits.hits.map(hit => {
            // @ts-ignore
            return hit._id || hit._source?.id?.toString();
        });        
        // Find orphaned entries (exist in ES but not in DB)
        const orphanedIds = esWorkflowIds.filter(id => !dbWorkflowIds.has(id));        
        // Delete orphaned entries
        let deletedCount = 0;
        for (const orphanedId of orphanedIds) {
            try {
                await esClient.delete({
                    index: WORKFLOWS_INDEX,
                    id: orphanedId
                });
                deletedCount++;
            } catch (err) {
                console.error(`Failed to delete orphaned workflow ${orphanedId}:`, err.message);
            }
        }
        return { deleted: deletedCount, total: esWorkflowIds.length };
    } catch (err) {
        console.error('Failed to cleanup orphaned entries:', err);
        throw err;
    }
}

/**
 * Reindex all workflows from database to Elasticsearch
 * @param {any} strapi - Strapi instance
 * @param {Function} getEmbedding - Function to generate embeddings
 * @returns {Promise<{indexed: number, errors: number, total: number}>}
 */
export async function reindexAllWorkflows(strapi, getEmbedding) {
    try {        
        // Get all workflows from database
        const workflows = await strapi.entityService.findMany('api::workflow.workflow', {
            limit: -1,
            fields: ['id', 'title', 'department', 'user_query', 'xml', 'session_id', 'createdAt', 'updatedAt', 'pdf_text', 'image_text', 'audio_text']
        });        
        let indexedCount = 0;
        let errorCount = 0;
        
        for (const workflow of workflows) {
            try {
                // Generate embedding if function is provided
                let workflowEmbedding = null;
                if (getEmbedding) {
                    try {
                        const embeddingParts = [
                            workflow.title || '',
                            workflow.user_query || '',
                            workflow.pdf_text || '',
                            workflow.image_text || '',
                            workflow.audio_text || '',
                            (workflow.xml || '').substring(0, 2000)
                        ].filter(part => part && part.trim());
                        
                        if (embeddingParts.length > 0) {
                            const workflowText = embeddingParts.join('\n\n');
                            workflowEmbedding = await getEmbedding(workflowText);
                        }
                    } catch (embedError) {
                        console.warn(`Failed to generate embedding for workflow ${workflow.id}:`, embedError.message);
                    }
                }
                
                // Index workflow
                await indexWorkflow({
                    id: workflow.id,
                    title: workflow.title,
                    department: workflow.department,
                    user_query: workflow.user_query || '',
                    xml: workflow.xml,
                    session_id: workflow.session_id,
                    created_at: workflow.createdAt,
                    updated_at: workflow.updatedAt,
                    pdf_text: workflow.pdf_text || null,
                    image_text: workflow.image_text || null,
                    audio_text: workflow.audio_text || null,
                    embedding: workflowEmbedding
                });
                
                indexedCount++;
                
                // Small delay to avoid rate limiting
                await new Promise(resolve => setTimeout(resolve, 50));
            } catch (err) {
                console.error(`Failed to reindex workflow ${workflow.id}:`, err.message);
                errorCount++;
            }
        }
        
        return { indexed: indexedCount, errors: errorCount, total: workflows.length };
    } catch (err) {
        console.error('Failed to reindex workflows:', err);
        throw err;
    }
}
