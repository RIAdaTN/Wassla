import { Component, OnInit, AfterViewInit, OnDestroy, ViewChild, ChangeDetectorRef, inject } from '@angular/core';
import { CommonModule, DOCUMENT } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, NavigationEnd } from '@angular/router';
import { firstValueFrom, filter } from 'rxjs';
import { TranslateModule } from '@ngx-translate/core';

// Shared UI Components
import { ChatInterfaceComponent, ChatMessage, ChatAttachment, IconComponent, ButtonComponent } from '@bpmnx/shared';
import { DiagramEditorComponent } from '@bpmnx/shared';
import { BpmnHistory } from '@bpmnx/bpmn-history';

// Services
import { BpmnEditorService } from '@bpmnx/bpmn-editor';
import { WorkflowService } from '@bpmnx/workflow.service';
import { AIService, ProcessWorkflowResponse } from '@bpmnx/ai.service';
import { WebSocketService } from '@bpmnx/websocket.service';
import { AuthService } from '@bpmnx/auth.service';
import { BpmnExportPdfService } from '@bpmnx/bpmn-export-pdf';
import { BpmnExportImageService } from '@bpmnx/bpmn-export-image';
import { BpmnExportDocxService } from '@bpmnx/bpmn-export-docx';

// Generator Services
import { BpmnGeneratorImageService } from '@bpmnx/bpmn-generator-image';
import { BpmnGeneratorPdfService } from '@bpmnx/bpmn-generator-pdf';
import { BpmnGeneratorAudioService } from '@bpmnx/bpmn-generator-audio';
import { BpmnGeneratorTextService } from '@bpmnx/bpmn-generator-text';

@Component({
  selector: 'app-diagrams',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslateModule, ChatInterfaceComponent, DiagramEditorComponent, BpmnHistory, IconComponent, ButtonComponent],
  templateUrl: './diagrams.component.html',
  styleUrls: ['./diagrams.component.scss']
})
export class DiagramsComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild(ChatInterfaceComponent) chatInterface!: ChatInterfaceComponent;
  @ViewChild(DiagramEditorComponent) diagramEditor!: DiagramEditorComponent;
  @ViewChild(BpmnHistory) bpmnHistory!: BpmnHistory;

  // UI State
  chatSidebarVisible = true;
  chatHistoryVisible = true;
  messages: ChatMessage[] = [];
  currentWorkflowTitle = '';
  showSaveButton = false;
  currentWorkflowId?: number;
  currentVersion?: number;
  currentVersionId?: number;
  currentStatus: 'draft' | 'in review' | 'approved' = 'draft';
  isLoading = false;

  // New Diagram Modals
  showNewDiagramOptionsModal = false;
  showEmptyDiagramModal = false;
  showUploadDiagramModal = false;
  newDiagramName = 'New Diagram';
  newDiagramDepartment = 'General';
  uploadedBpmnFile: File | null = null;
  uploadedBpmnFileName = '';
  availableDepartments: string[] = [];

  // Export Modal
  showExportModal = false;
  exportOptions = {
    pdf: false,
    docx: false,
    png: false
  };

  // Status Modal
  showStatusModal = false;

  // Internal state
  private sessionId = '';
  private modificationQueries: string[] = [];
  private currentXml = '';

  // Services
  private bpmnEditor = inject(BpmnEditorService);
  private workflowService = inject(WorkflowService);
  private aiService = inject(AIService);
  private wsService = inject(WebSocketService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private cdr = inject(ChangeDetectorRef);
  private document = inject(DOCUMENT);
  private loadedStylesheets: HTMLLinkElement[] = [];
  private pdfExportService = inject(BpmnExportPdfService);
  private imageExportService = inject(BpmnExportImageService);
  private docxExportService = inject(BpmnExportDocxService);
  private authService = inject(AuthService);

  // Generator Services
  private imageGeneratorService = inject(BpmnGeneratorImageService);
  private pdfGeneratorService = inject(BpmnGeneratorPdfService);
  private audioGeneratorService = inject(BpmnGeneratorAudioService);
  private textGeneratorService = inject(BpmnGeneratorTextService);

  ngOnInit() {
    this.loadBpmnStylesheets();
    this.sessionId = this.bpmnEditor.getSessionId();

    // Setup WebSocket listeners
    this.setupWebSocketListeners();

    // Load available departments
    this.loadDepartments();

    // Add welcome message - create new array reference for OnPush
    this.messages = [{
      role: 'system',
      content: 'Hello! I\'m your Process Advisor, how can I help you?',
      timestamp: new Date()
    }];

    // Check for workflowId and version in query params
    this.route.queryParams.subscribe(params => {
      const workflowId = params['workflowId'];
      const version = params['version'] ? parseInt(params['version'], 10) : undefined;
      if (workflowId) {
        const id = parseInt(workflowId, 10);
        if (!isNaN(id)) {
          // Load if different workflow or different version
          if (this.currentWorkflowId !== id || this.currentVersion !== version) {
            setTimeout(() => {
              this.loadWorkflow(id, version);
            }, 500);
          }
        }
      }
    });

    // Listen for navigation events to refresh history (handles route reuse)
    this.router.events.pipe(
      filter(event => event instanceof NavigationEnd)
    ).subscribe((event: NavigationEnd) => {
      // Only refresh if we are on the diagrams page
      if (this.bpmnHistory && (event.url === '/diagrams' || event.url.startsWith('/diagrams?'))) {
        this.bpmnHistory.refresh();
      }
    });

    // Trigger change detection after initialization
    this.cdr.detectChanges();
  }

  ngAfterViewInit() {
    // Initialize editor after view is initialized (ViewChild is available)
    if (this.diagramEditor) {
      this.bpmnEditor.initializeEditor(this.diagramEditor);

      // Listen to diagram changes
      this.diagramEditor.diagramChanged.subscribe((xml: string) => {
        this.currentXml = xml;
        this.bpmnEditor.setCurrentXml(xml);
        this.cdr.detectChanges();
      });
    }

    // Trigger change detection after view initialization
    this.cdr.detectChanges();

    // Also trigger after a short delay to ensure all child components are ready
    setTimeout(() => {
      this.cdr.detectChanges();
    }, 100);
  }

  ngOnDestroy() {
    this.wsService.disconnect();
    this.removeBpmnStylesheets();
  }

  private loadBpmnStylesheets() {
    const stylesheets = [
      'https://cdn.jsdelivr.net/npm/bpmn-js@18.6.2/dist/assets/bpmn-js.css',
      'https://cdn.jsdelivr.net/npm/bpmn-js@18.6.2/dist/assets/diagram-js.css',
      'https://cdn.jsdelivr.net/npm/bpmn-js@18.6.2/dist/assets/bpmn-font/css/bpmn.css'
    ];

    stylesheets.forEach(href => {
      // Check if stylesheet is already loaded
      const existingLink = this.document.querySelector(`link[href="${href}"]`) as HTMLLinkElement;
      if (existingLink) {
        return; // Already loaded, skip
      }

      const link = this.document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      link.id = `bpmn-css-${href.split('/').pop()}`;
      this.document.head.appendChild(link);
      this.loadedStylesheets.push(link);
    });
  }

  private removeBpmnStylesheets() {
    this.loadedStylesheets.forEach(link => {
      if (link.parentNode) {
        link.parentNode.removeChild(link);
      }
    });
    this.loadedStylesheets = [];
  }

  private setupWebSocketListeners() {
    this.wsService.connect();

    this.wsService.messages$.subscribe((data: any) => {
      if (data.type === 'xml' && data.content) {
        this.diagramEditor.loadXml(data.content);
      } else if (data.type === 'message') {
        this.addSystemMessage(data.content);
      }
    });
  }

  async onMessageSent(event: { text: string; attachments: ChatAttachment[] }) {
    const message = event.text.trim();
    if (!message && event.attachments.length === 0) return;

    // Add user message with attachments - create new array reference for OnPush
    this.messages = [...this.messages, {
      role: 'user',
      content: message || (event.attachments[0]?.type === 'image' ? 'Image attached' :
        event.attachments[0]?.type === 'audio' ? 'Audio attached' :
          event.attachments[0]?.type === 'pdf' ? 'PDF attached' :
            'Message sent'),
      timestamp: new Date(),
      attachments: event.attachments.length > 0 ? [...event.attachments] : undefined
    }];

    // Set loading state to show spinner
    this.isLoading = true;
    this.cdr.detectChanges();

    try {
      // Get current XML
      const currentXml = await this.diagramEditor.getXml();

      // Determine attachment type and process accordingly
      const imageAttachment = event.attachments.find(att => att.type === 'image');
      const pdfAttachment = event.attachments.find(att => att.type === 'pdf');
      const audioAttachment = event.attachments.find(att => att.type === 'audio');

      let response: ProcessWorkflowResponse | undefined;

      // Get current user ID for createdBy/updatedBy
      const currentUser = this.authService.currentUser();
      const accountId = currentUser?.id;

      // Process based on attachment type using appropriate service
      if (imageAttachment) {
        const imageBase64 = this.imageGeneratorService.extractImageBase64(imageAttachment);
        if (imageBase64) {
          const result = await this.imageGeneratorService.processImage(
            imageBase64,
            this.sessionId,
            message,
            currentXml,
            this.currentWorkflowId,
            accountId
          );
          response = result.response;
          if (!result.success) {
            throw new Error(result.error || 'Failed to process image');
          }
        } else {
          throw new Error('Failed to extract image data');
        }
      } else if (pdfAttachment) {
        const result = await this.pdfGeneratorService.processPdfFile(
          pdfAttachment.file,
          this.sessionId,
          message,
          currentXml,
          this.currentWorkflowId,
          accountId
        );
        response = result.response;
        if (!result.success) {
          throw new Error(result.error || 'Failed to process PDF');
        }
      } else if (audioAttachment) {
        const result = await this.audioGeneratorService.processAudio(
          audioAttachment.file,
          this.sessionId,
          message,
          currentXml,
          this.currentWorkflowId,
          accountId
        );
        response = result.response;
        if (!result.success) {
          throw new Error(result.error || 'Failed to process audio');
        }
      } else if (message) {
        // Text-only processing
        const result = await this.textGeneratorService.processText(
          message,
          this.sessionId,
          currentXml,
          this.currentWorkflowId,
          accountId
        );
        response = result.response;
        if (!result.success) {
          throw new Error(result.error || 'Failed to process text');
        }
      } else {
        throw new Error('No valid input provided');
      }

      // Clear loading state
      this.isLoading = false;
      this.cdr.detectChanges();

      if (response?.success) {
        await this.handleAIResponse(response, message);
      } else {
        this.addSystemMessage(response?.error || 'Unknown error occurred');
      }
    } catch (error: any) {
      // Clear loading state on error
      this.isLoading = false;
      this.addSystemMessage(`Error: ${error?.message || 'Failed to process request'}`);
      this.cdr.detectChanges();
    }
  }

  private async handleAIResponse(response: ProcessWorkflowResponse, userQuery: string) {
    if (response.type === 'question') {
      this.addSystemMessage(response.content || response.xml || 'I received your question but have no response.');
    } else if (response.type === 'creation' || response.type === 'modification') {
      if (response.xml) {
        // Update workflow info if provided
        if (response.workflow) {
          this.currentWorkflowId = response.workflow.id;
          if (response.workflow.title) {
            this.currentWorkflowTitle = response.workflow.title;
          }
          if (response.workflow.status) {
            this.currentStatus = response.workflow.status;
          } else {
            this.currentStatus = 'draft';
          }
        }

        // Reset modification queries for new workflow creations
        if (response.type === 'creation') {
          this.modificationQueries = [];
          // Refresh the history to show the newly created workflow
          setTimeout(() => {
            if (this.bpmnHistory) {
              this.bpmnHistory.refresh();
            }
          }, 500);
        }

        // Show save button for modifications
        const workflowId = this.currentWorkflowId || response.workflow?.id;
        if (response.type === 'modification' && workflowId) {
          if (userQuery.trim()) {
            this.modificationQueries.push(userQuery.trim());
          }
          this.showSaveButton = true;
        }

        // Load XML into diagram editor
        await this.diagramEditor.loadXml(response.xml);
        this.currentXml = response.xml;
        this.bpmnEditor.setCurrentXml(response.xml);

        this.addSystemMessage(response.type === 'creation'
          ? 'New workflow created successfully!'
          : 'Workflow updated successfully!');
      }
    } else {
      this.addSystemMessage(response.xml || response.content || 'Response received but format is unknown.');
    }
    this.cdr.detectChanges();
  }

  async loadWorkflow(workflowId: number, version?: number) {
    try {
      const workflow = await firstValueFrom(
        this.workflowService.getWorkflow(workflowId)
      );

      if (!workflow?.data) {
        this.addSystemMessage('Workflow not found');
        return;
      }

      // Get the specified version XML or latest version or use workflow XML
      let xmlToLoad = workflow.data.xml;

      const workflowVersions = workflow.data.workflow_versions;
      if (workflowVersions && workflowVersions.length > 0) {
        const versions = workflowVersions;

        if (version) {
          // Load specific version
          const specifiedVersion = versions.find((v: any) => v.version === version);
          if (specifiedVersion && specifiedVersion.xml) {
            xmlToLoad = specifiedVersion.xml;
          } else {
            this.addSystemMessage(`Version ${version} not found, loading latest version`);
            // Fallback to latest version
            const latestVersion = versions.sort((a: any, b: any) => (b.version || 0) - (a.version || 0))[0];
            if (latestVersion && latestVersion.xml) {
              xmlToLoad = latestVersion.xml;
            }
          }
        } else {
          // Load latest version
          const latestVersion = versions.sort((a: any, b: any) => (b.version || 0) - (a.version || 0))[0];
          if (latestVersion && latestVersion.xml) {
            xmlToLoad = latestVersion.xml;
          }
        }
      }

      if (xmlToLoad) {
        await this.diagramEditor.loadXml(xmlToLoad);
        this.currentWorkflowId = workflowId;
        this.currentVersion = version;
        this.currentWorkflowTitle = workflow.data.title;
        this.currentXml = xmlToLoad;
        this.bpmnEditor.setCurrentXml(xmlToLoad);
        this.modificationQueries = [];
        this.showSaveButton = false;

        // Load status - check if version is specified, otherwise use workflow status
        if (version && workflowVersions && workflowVersions.length > 0) {
          const specifiedVersion = workflowVersions.find((v: any) => v.version === version);
          if (specifiedVersion) {
            this.currentStatus = specifiedVersion.status || 'draft';
            this.currentVersionId = specifiedVersion.id;
          } else {
            this.currentStatus = workflow.data.status || 'draft';
            this.currentVersionId = undefined;
          }
        } else {
          // If no version specified, use the latest version's status and ID
          if (workflowVersions && workflowVersions.length > 0) {
            const latestVersion = workflowVersions.sort((a: any, b: any) => (b.version || 0) - (a.version || 0))[0];
            this.currentStatus = latestVersion.status || workflow.data.status || 'draft';
            this.currentVersionId = latestVersion.id;
          } else {
            this.currentStatus = workflow.data.status || 'draft';
            this.currentVersionId = undefined;
          }
        }
      } else {
        this.addSystemMessage('Error: Workflow has no XML data');
      }
    } catch (error) {
      console.error('Error loading workflow:', error);
      this.addSystemMessage('Error loading workflow');
    }
  }

  async saveWorkflow() {
    try {
      const xml = await this.diagramEditor.getXml();

      if (this.currentWorkflowId) {
        const combinedQueries = this.modificationQueries.length > 0
          ? this.modificationQueries.join('; ')
          : 'Manual save';

        // Get current user ID for createdBy/updatedBy
        const currentUser = this.authService.currentUser();
        const accountId = currentUser?.id;

        const response = await firstValueFrom(
          this.workflowService.saveVersion({
            workflowId: this.currentWorkflowId,
            xml,
            sessionId: this.sessionId,
            modificationQuery: combinedQueries,
            accountId
          })
        ) as { success: boolean; version?: number; message?: string };

        if (response?.success) {
          const versionNumber = response.version || 2;
          this.addSystemMessage(`Version ${versionNumber} saved successfully!`);
          this.modificationQueries = [];
          this.showSaveButton = false;
          // Refresh the history to update the workflow's updatedAt timestamp
          setTimeout(() => {
            if (this.bpmnHistory) {
              this.bpmnHistory.refresh();
            }
          }, 500);
        } else {
          this.addSystemMessage('Workflow version saved successfully!');
        }
      } else {
        this.addSystemMessage('Please provide a title and department to save as a new workflow');
      }
    } catch (error) {
      console.error('Error saving workflow:', error);
      this.addSystemMessage('Error saving workflow');
    }
  }

  onWorkflowSelected(workflowId: number) {
    this.loadWorkflow(workflowId);
  }

  onNewDiagramRequested() {
    this.showNewDiagramOptionsModal = true;
  }

  toggleChatSidebar() {
    this.chatSidebarVisible = !this.chatSidebarVisible;
  }

  toggleChatHistory() {
    this.chatHistoryVisible = !this.chatHistoryVisible;
  }

  // Modal handlers
  closeNewDiagramOptionsModal() {
    this.showNewDiagramOptionsModal = false;
  }

  openEmptyDiagramModal() {
    this.showNewDiagramOptionsModal = false;
    this.showEmptyDiagramModal = true;
  }

  closeEmptyDiagramModal() {
    this.showEmptyDiagramModal = false;
  }

  openUploadDiagramModal() {
    this.showNewDiagramOptionsModal = false;
    this.showUploadDiagramModal = true;
    // Reload departments when opening the modal to get the latest list
    this.loadDepartments();
  }

  private loadDepartments() {
    this.workflowService.getDocuments().subscribe({
      next: (data) => {
        // Extract unique department names
        const departments = new Set<string>();
        data.forEach(dept => {
          if (dept.department) {
            departments.add(dept.department);
          }
        });
        // Add 'General' as default if not present
        if (!departments.has('General')) {
          departments.add('General');
        }
        this.availableDepartments = Array.from(departments).sort();
        // Set default department if not set or if current value is not in the list
        if (!this.newDiagramDepartment || !this.availableDepartments.includes(this.newDiagramDepartment)) {
          this.newDiagramDepartment = this.availableDepartments[0] || 'General';
        }
        this.cdr.detectChanges();
      },
      error: (error) => {
        console.error('Error loading departments:', error);
        // Set default departments if API fails
        this.availableDepartments = ['General'];
        this.newDiagramDepartment = 'General';
        this.cdr.detectChanges();
      }
    });
  }

  closeUploadDiagramModal() {
    this.showUploadDiagramModal = false;
  }

  async createEmptyDiagram() {
    const diagramName = this.newDiagramName.trim() || 'New Diagram';

    // Create empty diagram with proper empty BPMN XML
    const emptyBpmn = `<?xml version="1.0" encoding="UTF-8"?>
                        <bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                                          xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
                                          xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
                                          xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
                                          id="Definitions_1"
                                          targetNamespace="http://bpmn.io/schema/bpmn"
                                          exporter="bpmn-js"
                                          exporterVersion="9.0.3">
                          <bpmn:process id="Process_1" isExecutable="false">
                            <bpmn:startEvent id="StartEvent_1"/>
                          </bpmn:process>
                          <bpmndi:BPMNDiagram id="BPMNDiagram_1">
                            <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Process_1">
                              <bpmndi:BPMNShape id="_BPMNShape_StartEvent_2" bpmnElement="StartEvent_1">
                                <dc:Bounds height="36.0" width="36.0" x="412.0" y="240.0"/>
                              </bpmndi:BPMNShape>
                            </bpmndi:BPMNPlane>
                          </bpmndi:BPMNDiagram>
                        </bpmn:definitions>`;

    // Clear current workflow state (not saved to database)
    this.currentWorkflowId = undefined;
    this.currentWorkflowTitle = diagramName;
    this.modificationQueries = [];
    this.showSaveButton = false;

    // Load the empty diagram into the editor to clear any existing diagram
    await this.diagramEditor.loadXml(emptyBpmn);
    this.currentXml = emptyBpmn;
    this.bpmnEditor.setCurrentXml(emptyBpmn);
    this.closeEmptyDiagramModal();
  }

  onBpmnFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      this.uploadedBpmnFile = input.files[0];
      this.uploadedBpmnFileName = input.files[0].name;
    }
  }

  async importBpmnDiagram() {
    if (!this.uploadedBpmnFile) return;

    try {
      const fileContent = await this.readFileAsText(this.uploadedBpmnFile);
      const diagramName = this.newDiagramName.trim() || 'Imported Diagram';
      const department = this.newDiagramDepartment.trim() || 'General';

      // Get current user ID for createdBy/updatedBy
      const currentUser = this.authService.currentUser();
      const accountId = currentUser?.id;

      const response = await firstValueFrom(
        this.workflowService.createWorkflow({
          title: diagramName,
          department: department,
          xml: fileContent,
          sessionId: this.sessionId,
          accountId
        })
      );

      if (response?.success && response.workflowId) {
        // Set the current workflow info
        this.currentWorkflowId = response.workflowId;
        this.currentWorkflowTitle = diagramName;
        this.modificationQueries = [];
        this.showSaveButton = false;

        // Load the diagram into the editor
        await this.diagramEditor.loadXml(fileContent);
        this.currentXml = fileContent;
        this.bpmnEditor.setCurrentXml(fileContent);

        // Refresh the history to show the newly imported workflow
        setTimeout(() => {
          if (this.bpmnHistory) {
            this.bpmnHistory.refresh();
          }
        }, 500);

        this.closeUploadDiagramModal();
      } else {
        throw new Error('Failed to save workflow');
      }
    } catch (error) {
      console.error('Error importing diagram:', error);
      this.addSystemMessage(`Error importing diagram: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private readFileAsText(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsText(file);
    });
  }

  private addSystemMessage(content: string) {
    // Create new array reference for OnPush change detection
    this.messages = [...this.messages, {
      role: 'system',
      content,
      timestamp: new Date()
    }];
    this.cdr.detectChanges();
  }

  // Export Modal handlers
  openExportModal() {
    this.showExportModal = true;
    // Reset options
    this.exportOptions = { pdf: false, docx: false, png: false };
  }

  closeExportModal() {
    this.showExportModal = false;
  }

  // Status Modal handlers
  openStatusModal() {
    this.showStatusModal = true;
  }

  closeStatusModal() {
    this.showStatusModal = false;
  }

  async updateStatus(newStatus: 'draft' | 'in review' | 'approved') {
    if (!this.currentWorkflowId) {
      this.addSystemMessage('No workflow selected');
      return;
    }

    try {
      const response = await firstValueFrom(
        this.workflowService.updateStatus(
          this.currentWorkflowId,
          newStatus,
          this.currentVersionId
        )
      );

      if (response.success) {
        this.currentStatus = newStatus;
        this.closeStatusModal();

        // Refresh history to show updated status
        setTimeout(() => {
          if (this.bpmnHistory) {
            this.bpmnHistory.refresh();
          }
        }, 500);
      } else {
        this.addSystemMessage('Failed to update status');
      }
    } catch (error) {
      console.error('Error updating status:', error);
      this.addSystemMessage('Error updating status');
    }
  }

  async handleExport() {
    if (!this.exportOptions.pdf && !this.exportOptions.docx && !this.exportOptions.png) {
      return;
    }

    // Close modal immediately
    this.closeExportModal();

    try {
      // Get current XML
      const xml = await this.diagramEditor.getXml();
      if (!xml || xml.trim() === '') {
        this.addSystemMessage('Cannot export: The diagram is empty.');
        return;
      }

      // Add generating message and track its index
      const generatingMessageIndex = this.messages.length;
      this.addSystemMessage('Generating workflow report...');

      if (this.exportOptions.pdf) {
        await this.exportPdf(xml, generatingMessageIndex);
      } else if (this.exportOptions.docx) {
        await this.exportDocx(xml, generatingMessageIndex);
      } else if (this.exportOptions.png) {
        await this.exportImage(generatingMessageIndex);
      }
    } catch (error) {
      console.error('Error during export:', error);
      // Replace generating message with error message
      const generatingIndex = this.messages.findIndex(msg => msg.content === 'Generating workflow report...');
      if (generatingIndex !== -1) {
        this.messages = this.messages.map((msg, idx) =>
          idx === generatingIndex
            ? { ...msg, content: 'An error occurred during export.' }
            : msg
        );
        this.cdr.detectChanges();
      } else {
        this.addSystemMessage('An error occurred during export.');
      }
    }
  }

  private async exportPdf(xml: string, generatingMessageIndex: number) {
    try {
      const description = await this.pdfExportService.getWorkflowDescription(xml, this.sessionId);

      if (!description || description.trim() === '') {
        this.replaceMessage(generatingMessageIndex, 'Cannot generate PDF: Failed to generate workflow description.');
        return;
      }

      // Export PDF using the service
      await this.pdfExportService.exportToPdf({
        xml,
        description,
        sessionId: this.sessionId
      }, this.diagramEditor);

      // Replace generating message with success message
      this.replaceMessage(generatingMessageIndex, 'PDF report generated successfully!');
    } catch (error) {
      console.error('Error generating PDF:', error);
      this.replaceMessage(generatingMessageIndex, 'An error occurred while generating the PDF.');
    }
  }

  private async exportDocx(xml: string, generatingMessageIndex: number) {
    try {
      // Get workflow description from AI (same as PDF)
      const description = await this.pdfExportService.getWorkflowDescription(xml, this.sessionId);

      if (!description || description.trim() === '') {
        this.replaceMessage(generatingMessageIndex, 'Cannot generate DOCX: Failed to generate workflow description.');
        return;
      }

      // Export DOCX using the service
      await this.docxExportService.exportToDocx({
        xml,
        description,
        sessionId: this.sessionId
      }, this.diagramEditor);

      // Replace generating message with success message
      this.replaceMessage(generatingMessageIndex, 'DOCX report generated successfully!');
    } catch (error) {
      console.error('Error generating DOCX:', error);
      this.replaceMessage(generatingMessageIndex, 'An error occurred while generating the DOCX.');
    }
  }

  private async exportImage(generatingMessageIndex: number) {
    try {
      await this.imageExportService.exportToImage(this.diagramEditor);
      this.replaceMessage(generatingMessageIndex, 'Diagram image exported successfully!');
    } catch (error) {
      console.error('Error exporting image:', error);
      this.replaceMessage(generatingMessageIndex, 'An error occurred while exporting the image.');
    }
  }

  private replaceMessage(index: number, newContent: string) {
    if (index >= 0 && index < this.messages.length) {
      this.messages = this.messages.map((msg, idx) =>
        idx === index
          ? { ...msg, content: newContent }
          : msg
      );
      this.cdr.detectChanges();
    }
  }
}

