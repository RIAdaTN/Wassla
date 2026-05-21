import { Component, OnInit, ViewChild, inject } from '@angular/core';
import { CommonModule, DOCUMENT } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
import { DocumentLibrary } from '@bpmnx/document-library';
import { DiagramEditorComponent, CardComponent, IconComponent } from '@bpmnx/shared';

@Component({
  selector: 'app-library',
  standalone: true,
  imports: [CommonModule, TranslateModule, DiagramEditorComponent, CardComponent, IconComponent],
  templateUrl: './library.component.html',
  styleUrls: ['./library.component.scss']
})
export class LibraryComponent extends DocumentLibrary implements OnInit {
  @ViewChild('bpmnPreviewCanvas', { static: false }) declare diagramEditor: DiagramEditorComponent;
  private document = inject(DOCUMENT);

  ngOnInit() {
    this.loadBpmnStylesheets();
    this.loadDocuments();
  }



  private loadBpmnStylesheets() {
    const stylesheets = [
      'https://cdn.jsdelivr.net/npm/bpmn-js@18.6.2/dist/assets/bpmn-js.css',
      'https://cdn.jsdelivr.net/npm/bpmn-js@18.6.2/dist/assets/diagram-js.css',
      'https://cdn.jsdelivr.net/npm/bpmn-js@18.6.2/dist/assets/bpmn-font/css/bpmn.css'
    ];

    if (!this.document || !this.document.head) {
      return;
    }

    stylesheets.forEach(href => {
      const filename = href.split('/').pop() || '';
      const existingLink = this.document.querySelector(`link[href="${href}"], link[href*="${filename}"]`) as HTMLLinkElement;

      if (existingLink) {
        return; // Already loaded
      }

      const link = this.document.createElement('link');
      link.rel = 'stylesheet';
      link.type = 'text/css';
      link.href = href;
      link.crossOrigin = 'anonymous';
      this.document.head.appendChild(link);
    });
  }
}
