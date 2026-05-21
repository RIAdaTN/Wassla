import { Component, OnInit, OnDestroy, ViewChild, ElementRef, AfterViewInit, ChangeDetectorRef, ViewEncapsulation, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { DomSanitizer } from '@angular/platform-browser';
import { TranslateModule } from '@ngx-translate/core';
import { WorkflowService } from '@bpmnx/workflow.service';
import { HubMessageProcessorService } from '@bpmnx/process-hub';
import { HubMessage } from '@bpmnx/process-hub';
import { DiagramEditorComponent, SpinnerComponent, IconComponent } from '@bpmnx/shared';

@Component({
  selector: 'app-hub',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslateModule, DiagramEditorComponent, SpinnerComponent, IconComponent],
  templateUrl: './hub.component.html',
  styleUrl: './hub.component.scss',
  encapsulation: ViewEncapsulation.None
})
export class HubComponent implements OnInit, AfterViewInit, OnDestroy {
  private workflowService = inject(WorkflowService);
  private router = inject(Router);
  private cdr = inject(ChangeDetectorRef);
  private sanitizer = inject(DomSanitizer);
  private messageProcessor = inject(HubMessageProcessorService);

  @ViewChild('messagesContainer', { static: false }) messagesContainerRef!: ElementRef<HTMLDivElement>;
  @ViewChild('chatInput', { static: false }) chatInputRef!: ElementRef<HTMLTextAreaElement>;

  chatInputText = '';
  messages: HubMessage[] = [];
  showBpmnModal = false;
  bpmnModalTitle = 'BPMN Diagram';
  bpmnModalXml = '';
  previewXml = ''; // Alias for bpmnModalXml to match library component pattern
  isLoading = false;
  private eventDelegationSetup = false;

  private readonly HUB_DEMO_BPMN_XML = `<?xml version="1.0" encoding="UTF-8"?>
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

  ngOnInit() {
    if (this.messages.length === 0) {
      this.initializeHubChat();
    }
    if (this.showBpmnModal) {
      this.closeBpmnModal();
    }
  }

  ngAfterViewInit() {
    this.eventDelegationSetup = false;
    this.setupEventDelegation();
    setTimeout(() => {
      if (!this.eventDelegationSetup) {
        this.setupEventDelegation();
      }
    }, 200);
    if (this.messages.length > 0) {
      setTimeout(() => this.scrollToBottom(), 100);
    }
  }

  ngOnDestroy() {
    this.closeBpmnModal();
  }

  private setupEventDelegation() {
    if (this.eventDelegationSetup || !this.messagesContainerRef?.nativeElement) {
      return;
    }

    const container = this.messagesContainerRef.nativeElement;
    const existingHandler = (container as any)._hubClickHandler;
    if (existingHandler) {
      container.removeEventListener('click', existingHandler, true);
    }

    const clickHandler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      let button: HTMLElement | null = target.closest('button.hub-demo-soap, button.hub-demo-edit') as HTMLElement;

      if (!button && target.tagName === 'BUTTON' &&
        (target.classList.contains('hub-demo-soap') || target.classList.contains('hub-demo-edit'))) {
        button = target;
      }

      if (button) {
        e.preventDefault();
        e.stopPropagation();
        const workflowId = button.getAttribute('data-workflow-id');
        const version = button.getAttribute('data-version');

        if (workflowId) {
          if (button.classList.contains('hub-demo-soap')) {
            const versionNum = version ? parseInt(version) : undefined;
            this.openBpmnModal(parseInt(workflowId), versionNum);
          } else if (button.classList.contains('hub-demo-edit')) {
            this.editWorkflow(parseInt(workflowId));
          }
        }
      }
    };

    (container as any)._hubClickHandler = clickHandler;
    container.addEventListener('click', clickHandler, true);
    this.eventDelegationSetup = true;
  }

  initializeHubChat() {
    const welcomeMessage: HubMessage = {
      content: this.sanitizer.bypassSecurityTrustHtml(this.messageProcessor.getWelcomeMessage()),
      sender: 'bot',
      timestamp: new Date(),
      allowHtml: true
    };
    this.messages.push(welcomeMessage);
    this.cdr.detectChanges();
    setTimeout(() => this.scrollToBottom(), 100);
  }

  sendMessage() {
    const message = this.chatInputText.trim();
    if (!message) return;

    this.addMessage(message, 'user');
    this.chatInputText = '';
    this.isLoading = true;
    this.cdr.detectChanges();

    setTimeout(() => {
      this.processMessage(message);
    }, 800);
  }

  private processMessage(message: string) {
    // Use Elasticsearch search instead of static matches
    this.workflowService.searchSimilarWorkflows(message).subscribe({
      next: (response) => {
        this.isLoading = false;
        if (response.data && response.data.length > 0) {
          // Display all similar workflows with their versions
          const workflowsResponse = this.messageProcessor.buildWorkflowsResponse(response.data);
          this.addMessage(workflowsResponse, 'bot', true);
          this.cdr.detectChanges();
          this.eventDelegationSetup = false;
          this.setupEventDelegation();
          setTimeout(() => this.scrollToBottom(), 100);
        } else {
          // No matching workflows found
          const noMatchResponse = this.messageProcessor.getNoMatchingWorkflowsResponse();
          this.addMessage(noMatchResponse, 'bot', true);
          this.cdr.detectChanges();
          setTimeout(() => this.scrollToBottom(), 100);
        }
      },
      error: (error) => {
        this.isLoading = false;
        console.error('Error searching workflows:', error);
        const defaultResponse = this.messageProcessor.getDefaultResponse();
        this.addMessage(defaultResponse, 'bot', true);
        this.cdr.detectChanges();
        setTimeout(() => this.scrollToBottom(), 100);
      }
    });
  }

  // Removed fetchAndDisplayWorkflow - now handled in processMessage with search results

  private openBpmnModal(workflowId: number, version?: number) {
    if (version) {
      // Get specific version XML
      this.workflowService.getVersionXml(workflowId, version).subscribe({
        next: (xml) => {
          this.bpmnModalXml = xml || this.HUB_DEMO_BPMN_XML;
          this.previewXml = this.bpmnModalXml;
          this.bpmnModalTitle = `Workflow ${workflowId} - Version ${version}`;
          this.showBpmnModal = true;
          this.cdr.detectChanges();
        },
        error: (error) => {
          console.error(`Error fetching workflow ${workflowId} version ${version}:`, error);
          // Fallback to getting the workflow
          this.workflowService.getWorkflow(workflowId).subscribe({
            next: (response) => {
              const workflowData = response?.data;
              this.bpmnModalXml = workflowData?.xml || this.HUB_DEMO_BPMN_XML;
              this.previewXml = this.bpmnModalXml;
              this.bpmnModalTitle = workflowData?.title || 'BPMN Diagram';
              this.showBpmnModal = true;
              this.cdr.detectChanges();
            },
            error: (err) => {
              console.error('Error fetching workflow for modal:', err);
              this.bpmnModalXml = this.HUB_DEMO_BPMN_XML;
              this.previewXml = this.bpmnModalXml;
              this.bpmnModalTitle = 'Demo BPMN Diagram';
              this.showBpmnModal = true;
              this.cdr.detectChanges();
            }
          });
        }
      });
    } else {
      // Get workflow (latest version)
      this.workflowService.getWorkflow(workflowId).subscribe({
        next: (response) => {
          const workflowData = response?.data;
          // Get latest version XML if available
          const versions = workflowData?.workflow_versions || [];
          const latestVersion = versions.length > 0
            ? versions.sort((a: any, b: any) => (b.version || 0) - (a.version || 0))[0]
            : null;
          this.bpmnModalXml = latestVersion?.xml || workflowData?.xml || this.HUB_DEMO_BPMN_XML;
          this.previewXml = this.bpmnModalXml;
          this.bpmnModalTitle = workflowData?.title || 'BPMN Diagram';
          this.showBpmnModal = true;
          this.cdr.detectChanges();
        },
        error: (error) => {
          console.error('Error fetching workflow for modal:', error);
          this.bpmnModalXml = this.HUB_DEMO_BPMN_XML;
          this.previewXml = this.bpmnModalXml;
          this.bpmnModalTitle = 'Demo BPMN Diagram';
          this.showBpmnModal = true;
          this.cdr.detectChanges();
        }
      });
    }
  }

  private editWorkflow(workflowId: number) {
    this.router.navigate(['/diagrams'], {
      queryParams: { workflowId: workflowId }
    });
  }

  closeBpmnModal() {
    this.showBpmnModal = false;
    this.bpmnModalXml = '';
    this.previewXml = '';
    this.cdr.detectChanges();
  }

  addMessage(content: string, sender: 'user' | 'bot', allowHtml = false) {
    const sanitizedContent = allowHtml
      ? this.sanitizer.bypassSecurityTrustHtml(content)
      : content;

    this.messages.push({
      content: sanitizedContent,
      sender,
      timestamp: new Date(),
      allowHtml
    });
    this.cdr.detectChanges();
    setTimeout(() => this.scrollToBottom(), 50);
  }

  scrollToBottom() {
    if (this.messagesContainerRef?.nativeElement) {
      setTimeout(() => {
        const container = this.messagesContainerRef.nativeElement;
        container.scrollTop = container.scrollHeight;
      }, 100);
    }
  }

  onEnterKey(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.sendMessage();
    }
  }

  onInputResize() {
    if (this.chatInputRef?.nativeElement) {
      const input = this.chatInputRef.nativeElement;
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 120) + 'px';
    }
  }

}

