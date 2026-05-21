import { Component, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { AuthService } from '@bpmnx/auth.service';
import { PermissionService } from '@bpmnx/permission-service';

// Auth Features
import { LoginFeature } from '@bpmnx/auth';
import { RegisterFeature } from '@bpmnx/auth';
import { ValidationUtility } from '@bpmnx/auth';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslateModule],
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.scss']
})
export class LoginComponent {
  private authService = inject(AuthService);
  private router = inject(Router);
  private permissionService = inject(PermissionService);

  isLoginMode = signal<boolean>(true);
  isLoading = signal<boolean>(false);
  error = signal<string | null>(null);

  // Feature instances
  loginFeature: LoginFeature;
  registerFeature: RegisterFeature;
  validationUtility: ValidationUtility;

  constructor() {
    // Initialize utilities
    this.validationUtility = new ValidationUtility();

    // Initialize features
    this.loginFeature = new LoginFeature(
      this.authService,
      this.router,
      (error) => { this.error.set(error); },
      (loading) => { this.isLoading.set(loading); },
      this.permissionService
    );

    this.registerFeature = new RegisterFeature(
      this.authService,
      this.router,
      this.validationUtility,
      (error) => { this.error.set(error); },
      (loading) => { this.isLoading.set(loading); },
      this.permissionService
    );

    // Redirect if already authenticated
    if (this.authService.isAuthenticated()) {
      // Navigate to first visible nav item
      const firstNav = this.getFirstVisibleNavItem();
      this.router.navigate([`/${firstNav}`]);
    }
  }

  /**
   * Get the first visible nav item based on permissions
   */
  private getFirstVisibleNavItem(): string {
    // Check in order: Diagrams, Hub, Library, Access Control
    if (this.permissionService.canAccessDiagrams()) {
      return 'diagrams';
    }
    // Hub is always visible
    return 'hub';
  }



  toggleMode(): void {
    this.isLoginMode.set(!this.isLoginMode());
    this.error.set(null);
    this.clearForm();
  }

  onLogin(): void {
    this.loginFeature.login();
  }

  onRegister(): void {
    this.registerFeature.register();
  }

  private clearForm(): void {
    this.loginFeature.clearForm();
    this.registerFeature.clearForm();
  }

  // Expose feature properties for template
  get loginIdentifier() {
    return this.loginFeature.loginIdentifier;
  }

  get loginPassword() {
    return this.loginFeature.loginPassword;
  }

  get registerUsername() {
    return this.registerFeature.registerUsername;
  }

  get registerEmail() {
    return this.registerFeature.registerEmail;
  }

  get registerPassword() {
    return this.registerFeature.registerPassword;
  }

  get registerConfirmPassword() {
    return this.registerFeature.registerConfirmPassword;
  }
}
