/**
 * Custom components referenced from manifests by `component` name. Workflow-specific components live in
 * src/workflows/<workflow-key>/ and are registered here. Empty by default.
 */
import type { InputComponent } from '../renderer/types';

export const customComponents: Record<string, InputComponent> = {};
