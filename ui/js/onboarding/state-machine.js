/**
 * FlowGuard — Onboarding State Machine (UI orchestrator)
 *
 * Coordinates between the wizard UI and the tenant persistence layer.
 * Enforces step validation before allowing transitions.
 */

import {
  OnboardingState,
  ORDERED_STATES,
  loadTenant,
  saveTenant,
  advanceOnboarding,
  rewindOnboarding,
  updateProfile,
  updateRiskPreferences,
  connectDataSource,
  storeValidationResult,
  storeInitialAssessment,
  onboardingProgress,
} from '../tenant.js';

/**
 * Validation rules per step.
 * Returns null if valid, or an error message string if invalid.
 */
const VALIDATORS = {
  [OnboardingState.BUSINESS_PROFILE]: (tenant) => {
    const p = tenant.profile;
    if (!p.organizationName?.trim()) return 'Organization name is required.';
    if (!p.industry)                 return 'Please select your industry.';
    if (!p.timezone)                 return 'Please select a timezone.';
    if (!p.currency)                 return 'Please select a currency.';
    if (!p.payrollSchedule)          return 'Please select a payroll schedule.';
    if (p.minimumLiquidityBuffer === null || p.minimumLiquidityBuffer === '')
                                     return 'Minimum liquidity buffer is required.';
    if (!p.receivableTermsDays)      return 'Please select typical receivable terms.';
    return null;
  },

  [OnboardingState.RISK_PREFERENCES]: (tenant) => {
    const r = tenant.riskPreferences;
    if (!r.riskTolerance)           return 'Please select a risk tolerance level.';
    if (!r.forecastHorizonDays)     return 'Please select a forecast horizon.';
    if (!r.alertSensitivity)        return 'Please select an alert sensitivity.';
    return null;
  },

  [OnboardingState.DATA_CONNECTIONS]: (_tenant) => {
    // Data connections are optional — user may skip and connect later
    // Validation happens in DATA_VALIDATION step
    return null;
  },

  [OnboardingState.DATA_VALIDATION]: (_tenant) => {
    // Validation is run by the engine, not by user input
    return null;
  },

  [OnboardingState.INITIAL_CALCULATION]: (_tenant) => {
    return null;
  },
};

export class OnboardingStateMachine {
  /**
   * @param {string} tenantId
   * @param {Storage} storage - injectable for testing
   */
  constructor(tenantId, storage = localStorage) {
    this.tenantId = tenantId;
    this.storage  = storage;
  }

  get tenant() {
    return loadTenant(this.tenantId, this.storage);
  }

  get currentState() {
    return this.tenant?.onboardingState ?? OnboardingState.BUSINESS_PROFILE;
  }

  get progress() {
    return onboardingProgress(this.tenant);
  }

  get stepIndex() {
    return ORDERED_STATES.indexOf(this.currentState);
  }

  /**
   * Validate the current step. Returns { valid: bool, error: string|null }.
   */
  validateCurrentStep() {
    const tenant    = this.tenant;
    const validator = VALIDATORS[this.currentState];
    if (!validator) return { valid: true, error: null };
    const error = validator(tenant);
    return { valid: !error, error };
  }

  /**
   * Save profile data (step 1).
   */
  saveProfile(profileData) {
    const tenant = this.tenant;
    updateProfile(tenant, { ...profileData, completedAt: null }, this.storage);
  }

  /**
   * Save risk preferences (step 2).
   */
  saveRiskPreferences(prefData) {
    const tenant = this.tenant;
    updateRiskPreferences(tenant, { ...prefData, completedAt: null }, this.storage);
  }

  /**
   * Attempt to advance to the next step.
   * @returns {{ success: bool, error?: string, nextState?: string }}
   */
  advance() {
    const { valid, error } = this.validateCurrentStep();
    if (!valid) return { success: false, error };

    const tenant = this.tenant;
    // Mark step as completed
    if (this.currentState === OnboardingState.BUSINESS_PROFILE) {
      tenant.profile.completedAt = new Date().toISOString();
      saveTenant(tenant, this.storage);
    }
    if (this.currentState === OnboardingState.RISK_PREFERENCES) {
      tenant.riskPreferences.completedAt = new Date().toISOString();
      saveTenant(tenant, this.storage);
    }

    try {
      advanceOnboarding(tenant, this.storage);
      return { success: true, nextState: tenant.onboardingState };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  /**
   * Go back to a previous step.
   */
  goBack(targetState) {
    const tenant = this.tenant;
    rewindOnboarding(tenant, targetState, this.storage);
  }

  /**
   * Register a data source connection result.
   */
  addDataSource(source) {
    const tenant = this.tenant;
    connectDataSource(tenant, source, this.storage);
  }

  /**
   * Store the result from the data readiness audit.
   */
  setValidationResult(result) {
    const tenant = this.tenant;
    storeValidationResult(tenant, result, this.storage);
  }

  /**
   * Store the initial financial assessment.
   */
  setInitialAssessment(assessment) {
    const tenant = this.tenant;
    storeInitialAssessment(tenant, assessment, this.storage);
  }
}
