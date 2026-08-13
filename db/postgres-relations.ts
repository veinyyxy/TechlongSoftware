import { relations } from "drizzle-orm/relations";
import { products, appInstanceTemplates, appInstanceTemplateVersions, plans, users, userCredentials, authSessions, authInvitations, workspaces, subscriptions, paymentRecords, paymentCheckoutSessions, appInstances, subscriptionPurchaseOrders, deploymentEnvironments, deploymentEnvironmentBindings, appInstanceDeployments, deploymentTenantResources, deploymentTenantResourceEvents, deploymentCleanupSchedules, deploymentEnvironmentCapacityReservations, deploymentJobs, deploymentStepRuns, paymentWebhookEvents, workspaceMembers, workspaceProductEntitlements, deploymentTenantExternalOperations, deploymentTenantExternalOperationEvents, deploymentTenantCleanupRuns, deploymentTenantCleanupPhases, deploymentTenantCleanupEvents } from "./postgres-schema";

export const appInstanceTemplatesRelations = relations(appInstanceTemplates, ({one, many}) => ({
	product: one(products, {
		fields: [appInstanceTemplates.productId],
		references: [products.id]
	}),
	appInstanceTemplateVersions: many(appInstanceTemplateVersions),
}));

export const productsRelations = relations(products, ({many}) => ({
	appInstanceTemplates: many(appInstanceTemplates),
	plans: many(plans),
	subscriptions: many(subscriptions),
	appInstances: many(appInstances),
	subscriptionPurchaseOrders: many(subscriptionPurchaseOrders),
	deploymentTenantResources: many(deploymentTenantResources),
	workspaceProductEntitlements: many(workspaceProductEntitlements),
}));

export const appInstanceTemplateVersionsRelations = relations(appInstanceTemplateVersions, ({one, many}) => ({
	appInstanceTemplate: one(appInstanceTemplates, {
		fields: [appInstanceTemplateVersions.templateId],
		references: [appInstanceTemplates.id]
	}),
	plans: many(plans),
	subscriptions: many(subscriptions),
	appInstances: many(appInstances),
	subscriptionPurchaseOrders: many(subscriptionPurchaseOrders),
}));

export const plansRelations = relations(plans, ({one, many}) => ({
	product: one(products, {
		fields: [plans.productId],
		references: [products.id]
	}),
	appInstanceTemplateVersion: one(appInstanceTemplateVersions, {
		fields: [plans.templateVersionId],
		references: [appInstanceTemplateVersions.id]
	}),
	workspaces: many(workspaces),
	subscriptions: many(subscriptions),
	paymentCheckoutSessions: many(paymentCheckoutSessions),
	subscriptionPurchaseOrders: many(subscriptionPurchaseOrders),
}));

export const workspacesRelations = relations(workspaces, ({one, many}) => ({
	user: one(users, {
		fields: [workspaces.ownerId],
		references: [users.id]
	}),
	plan: one(plans, {
		fields: [workspaces.planId],
		references: [plans.id]
	}),
	subscriptions: many(subscriptions),
	paymentRecords: many(paymentRecords),
	paymentCheckoutSessions: many(paymentCheckoutSessions),
	appInstances: many(appInstances),
	deploymentTenantResources: many(deploymentTenantResources),
	subscriptionPurchaseOrders: many(subscriptionPurchaseOrders),
	workspaceMembers: many(workspaceMembers),
	workspaceProductEntitlements: many(workspaceProductEntitlements),
}));

export const usersRelations = relations(users, ({one, many}) => ({
	workspaces: many(workspaces),
	userCredential: one(userCredentials),
	authSessions: many(authSessions),
	authInvitations: many(authInvitations, {
		relationName: "authInvitations_userId_users_id"
	}),
	createdAuthInvitations: many(authInvitations, {
		relationName: "authInvitations_createdByUserId_users_id"
	}),
	subscriptions: many(subscriptions),
	paymentRecords: many(paymentRecords),
	paymentCheckoutSessions: many(paymentCheckoutSessions),
	appInstances: many(appInstances),
	subscriptionPurchaseOrders: many(subscriptionPurchaseOrders),
	workspaceMembers: many(workspaceMembers),
}));

export const userCredentialsRelations = relations(userCredentials, ({one}) => ({
	user: one(users, {
		fields: [userCredentials.userId],
		references: [users.id]
	}),
}));

export const authSessionsRelations = relations(authSessions, ({one}) => ({
	user: one(users, {
		fields: [authSessions.userId],
		references: [users.id]
	}),
}));

export const authInvitationsRelations = relations(authInvitations, ({one}) => ({
	user: one(users, {
		fields: [authInvitations.userId],
		references: [users.id],
		relationName: "authInvitations_userId_users_id"
	}),
	createdByUser: one(users, {
		fields: [authInvitations.createdByUserId],
		references: [users.id],
		relationName: "authInvitations_createdByUserId_users_id"
	}),
}));

export const subscriptionsRelations = relations(subscriptions, ({one, many}) => ({
	workspace: one(workspaces, {
		fields: [subscriptions.workspaceId],
		references: [workspaces.id]
	}),
	product: one(products, {
		fields: [subscriptions.productId],
		references: [products.id]
	}),
	plan: one(plans, {
		fields: [subscriptions.planId],
		references: [plans.id]
	}),
	appInstanceTemplateVersion: one(appInstanceTemplateVersions, {
		fields: [subscriptions.templateVersionId],
		references: [appInstanceTemplateVersions.id]
	}),
	user: one(users, {
		fields: [subscriptions.createdByUserId],
		references: [users.id]
	}),
	paymentRecords: many(paymentRecords),
	paymentCheckoutSessions: many(paymentCheckoutSessions),
	appInstances: many(appInstances),
	subscriptionPurchaseOrders_subscriptionId: many(subscriptionPurchaseOrders, {
		relationName: "subscriptionPurchaseOrders_subscriptionId_subscriptions_id"
	}),
	subscriptionPurchaseOrders_renewalSubscriptionId: many(subscriptionPurchaseOrders, {
		relationName: "subscriptionPurchaseOrders_renewalSubscriptionId_subscriptions_id"
	}),
	workspaceProductEntitlements: many(workspaceProductEntitlements),
	appInstanceDeployments: many(appInstanceDeployments),
}));

export const paymentRecordsRelations = relations(paymentRecords, ({one, many}) => ({
	workspace: one(workspaces, {
		fields: [paymentRecords.workspaceId],
		references: [workspaces.id]
	}),
	subscription: one(subscriptions, {
		fields: [paymentRecords.subscriptionId],
		references: [subscriptions.id]
	}),
	user: one(users, {
		fields: [paymentRecords.recordedByUserId],
		references: [users.id]
	}),
	paymentCheckoutSessions: many(paymentCheckoutSessions),
	subscriptionPurchaseOrders: many(subscriptionPurchaseOrders),
}));

export const paymentCheckoutSessionsRelations = relations(paymentCheckoutSessions, ({one, many}) => ({
	workspace: one(workspaces, {
		fields: [paymentCheckoutSessions.workspaceId],
		references: [workspaces.id]
	}),
	subscription: one(subscriptions, {
		fields: [paymentCheckoutSessions.subscriptionId],
		references: [subscriptions.id]
	}),
	plan: one(plans, {
		fields: [paymentCheckoutSessions.planId],
		references: [plans.id]
	}),
	paymentRecord: one(paymentRecords, {
		fields: [paymentCheckoutSessions.paymentRecordId],
		references: [paymentRecords.id]
	}),
	user: one(users, {
		fields: [paymentCheckoutSessions.initiatedByUserId],
		references: [users.id]
	}),
	paymentWebhookEvents: many(paymentWebhookEvents),
}));

export const deploymentEnvironmentsRelations = relations(deploymentEnvironments, ({one, many}) => ({
	appInstanceDeployments: many(appInstanceDeployments),
	deploymentEnvironmentBinding: one(deploymentEnvironmentBindings),
	deploymentCleanupSchedules: many(deploymentCleanupSchedules),
	deploymentEnvironmentCapacityReservations: many(deploymentEnvironmentCapacityReservations),
	deploymentTenantResources: many(deploymentTenantResources),
}));

export const deploymentEnvironmentBindingsRelations = relations(deploymentEnvironmentBindings, ({one}) => ({
	deploymentEnvironment: one(deploymentEnvironments, {
		fields: [deploymentEnvironmentBindings.environmentId],
		references: [deploymentEnvironments.id]
	}),
}));

export const appInstanceDeploymentsRelations = relations(appInstanceDeployments, ({one, many}) => ({
	appInstance: one(appInstances, {
		fields: [appInstanceDeployments.appInstanceId],
		references: [appInstances.id]
	}),
	subscription: one(subscriptions, {
		fields: [appInstanceDeployments.subscriptionId],
		references: [subscriptions.id]
	}),
	subscriptionPurchaseOrder: one(subscriptionPurchaseOrders, {
		fields: [appInstanceDeployments.purchaseOrderId],
		references: [subscriptionPurchaseOrders.id]
	}),
	deploymentEnvironment: one(deploymentEnvironments, {
		fields: [appInstanceDeployments.environmentId],
		references: [deploymentEnvironments.id]
	}),
	deploymentJobs: many(deploymentJobs),
	deploymentStepRuns: many(deploymentStepRuns),
	deploymentCleanupSchedule: one(deploymentCleanupSchedules),
	deploymentEnvironmentCapacityReservation: one(deploymentEnvironmentCapacityReservations),
	createdTenantResource: one(deploymentTenantResources, {
		fields: [appInstanceDeployments.id],
		references: [deploymentTenantResources.createdByDeploymentId],
		relationName: "deploymentTenantResources_createdByDeployment"
	}),
	ownedTenantResource: one(deploymentTenantResources, {
		fields: [appInstanceDeployments.id],
		references: [deploymentTenantResources.ownerDeploymentId],
		relationName: "deploymentTenantResources_ownerDeployment"
	}),
	tenantResourceEvents: many(deploymentTenantResourceEvents),
	tenantExternalOperations: many(deploymentTenantExternalOperations),
	tenantExternalOperationEvents: many(deploymentTenantExternalOperationEvents),
	tenantCleanupRuns: many(deploymentTenantCleanupRuns),
}));

export const deploymentTenantResourcesRelations = relations(deploymentTenantResources, ({one, many}) => ({
	createdByDeployment: one(appInstanceDeployments, {
		fields: [deploymentTenantResources.createdByDeploymentId],
		references: [appInstanceDeployments.id],
		relationName: "deploymentTenantResources_createdByDeployment"
	}),
	ownerDeployment: one(appInstanceDeployments, {
		fields: [deploymentTenantResources.ownerDeploymentId],
		references: [appInstanceDeployments.id],
		relationName: "deploymentTenantResources_ownerDeployment"
	}),
	appInstance: one(appInstances, {
		fields: [deploymentTenantResources.appInstanceId],
		references: [appInstances.id]
	}),
	deploymentEnvironment: one(deploymentEnvironments, {
		fields: [deploymentTenantResources.environmentId],
		references: [deploymentEnvironments.id]
	}),
	workspace: one(workspaces, {
		fields: [deploymentTenantResources.workspaceId],
		references: [workspaces.id]
	}),
	product: one(products, {
		fields: [deploymentTenantResources.productId],
		references: [products.id]
	}),
	events: many(deploymentTenantResourceEvents),
	externalOperations: many(deploymentTenantExternalOperations),
	activeExternalOperation: one(deploymentTenantExternalOperations, {
		fields: [deploymentTenantResources.appInstanceId, deploymentTenantResources.generation, deploymentTenantResources.externalOperationEpoch],
		references: [deploymentTenantExternalOperations.appInstanceId, deploymentTenantExternalOperations.generation, deploymentTenantExternalOperations.epoch],
		relationName: "deploymentTenantResource_activeExternalOperation"
	}),
}));

export const deploymentTenantResourceEventsRelations = relations(deploymentTenantResourceEvents, ({one}) => ({
	tenantResource: one(deploymentTenantResources, {
		fields: [deploymentTenantResourceEvents.appInstanceId],
		references: [deploymentTenantResources.appInstanceId]
	}),
	deployment: one(appInstanceDeployments, {
		fields: [deploymentTenantResourceEvents.deploymentId],
		references: [appInstanceDeployments.id]
	}),
}));

export const deploymentCleanupSchedulesRelations = relations(deploymentCleanupSchedules, ({one}) => ({
	appInstanceDeployment: one(appInstanceDeployments, {
		fields: [deploymentCleanupSchedules.deploymentId],
		references: [appInstanceDeployments.id]
	}),
	deploymentEnvironment: one(deploymentEnvironments, {
		fields: [deploymentCleanupSchedules.environmentId],
		references: [deploymentEnvironments.id]
	}),
}));

export const deploymentEnvironmentCapacityReservationsRelations = relations(deploymentEnvironmentCapacityReservations, ({one}) => ({
	appInstanceDeployment: one(appInstanceDeployments, {
		fields: [deploymentEnvironmentCapacityReservations.deploymentId],
		references: [appInstanceDeployments.id]
	}),
	deploymentEnvironment: one(deploymentEnvironments, {
		fields: [deploymentEnvironmentCapacityReservations.environmentId],
		references: [deploymentEnvironments.id]
	}),
}));

export const deploymentJobsRelations = relations(deploymentJobs, ({one, many}) => ({
	appInstanceDeployment: one(appInstanceDeployments, {
		fields: [deploymentJobs.deploymentId],
		references: [appInstanceDeployments.id]
	}),
	deploymentStepRuns: many(deploymentStepRuns),
	createdTenantExternalOperations: many(deploymentTenantExternalOperations),
}));

export const deploymentStepRunsRelations = relations(deploymentStepRuns, ({one}) => ({
	appInstanceDeployment: one(appInstanceDeployments, {
		fields: [deploymentStepRuns.deploymentId],
		references: [appInstanceDeployments.id]
	}),
	deploymentJob: one(deploymentJobs, {
		fields: [deploymentStepRuns.jobId],
		references: [deploymentJobs.id]
	}),
}));

export const appInstancesRelations = relations(appInstances, ({one, many}) => ({
	workspace: one(workspaces, {
		fields: [appInstances.workspaceId],
		references: [workspaces.id]
	}),
	product: one(products, {
		fields: [appInstances.productId],
		references: [products.id]
	}),
	subscription: one(subscriptions, {
		fields: [appInstances.subscriptionId],
		references: [subscriptions.id]
	}),
	appInstanceTemplateVersion: one(appInstanceTemplateVersions, {
		fields: [appInstances.templateVersionId],
		references: [appInstanceTemplateVersions.id]
	}),
	user: one(users, {
		fields: [appInstances.createdByUserId],
		references: [users.id]
	}),
	workspaceProductEntitlements: many(workspaceProductEntitlements),
	appInstanceDeployments: many(appInstanceDeployments),
	deploymentTenantResource: one(deploymentTenantResources),
}));

export const deploymentTenantExternalOperationsRelations = relations(deploymentTenantExternalOperations, ({one, many}) => ({
	tenantResource: one(deploymentTenantResources, {
		fields: [deploymentTenantExternalOperations.appInstanceId],
		references: [deploymentTenantResources.appInstanceId]
	}),
	activeForTenantResource: one(deploymentTenantResources, {
		fields: [deploymentTenantExternalOperations.appInstanceId, deploymentTenantExternalOperations.generation, deploymentTenantExternalOperations.epoch],
		references: [deploymentTenantResources.appInstanceId, deploymentTenantResources.generation, deploymentTenantResources.externalOperationEpoch],
		relationName: "deploymentTenantResource_activeExternalOperation"
	}),
	ownerDeployment: one(appInstanceDeployments, {
		fields: [deploymentTenantExternalOperations.ownerDeploymentId],
		references: [appInstanceDeployments.id]
	}),
	createdByJob: one(deploymentJobs, {
		fields: [deploymentTenantExternalOperations.createdByJobId],
		references: [deploymentJobs.id]
	}),
	events: many(deploymentTenantExternalOperationEvents),
	cleanupRun: one(deploymentTenantCleanupRuns),
}));

export const deploymentTenantExternalOperationEventsRelations = relations(deploymentTenantExternalOperationEvents, ({one}) => ({
	externalOperation: one(deploymentTenantExternalOperations, {
		fields: [deploymentTenantExternalOperationEvents.appInstanceId, deploymentTenantExternalOperationEvents.generation, deploymentTenantExternalOperationEvents.epoch],
		references: [deploymentTenantExternalOperations.appInstanceId, deploymentTenantExternalOperations.generation, deploymentTenantExternalOperations.epoch]
	}),
	deployment: one(appInstanceDeployments, {
		fields: [deploymentTenantExternalOperationEvents.deploymentId],
		references: [appInstanceDeployments.id]
	}),
}));

export const deploymentTenantCleanupRunsRelations = relations(deploymentTenantCleanupRuns, ({one, many}) => ({
	externalOperation: one(deploymentTenantExternalOperations, {
		fields: [deploymentTenantCleanupRuns.appInstanceId, deploymentTenantCleanupRuns.generation, deploymentTenantCleanupRuns.externalEpoch, deploymentTenantCleanupRuns.ownerDeploymentId],
		references: [deploymentTenantExternalOperations.appInstanceId, deploymentTenantExternalOperations.generation, deploymentTenantExternalOperations.epoch, deploymentTenantExternalOperations.ownerDeploymentId]
	}),
	ownerDeployment: one(appInstanceDeployments, {
		fields: [deploymentTenantCleanupRuns.ownerDeploymentId],
		references: [appInstanceDeployments.id]
	}),
	phases: many(deploymentTenantCleanupPhases),
	events: many(deploymentTenantCleanupEvents),
}));

export const deploymentTenantCleanupPhasesRelations = relations(deploymentTenantCleanupPhases, ({one}) => ({
	run: one(deploymentTenantCleanupRuns, {
		fields: [deploymentTenantCleanupPhases.runId],
		references: [deploymentTenantCleanupRuns.id]
	}),
}));

export const deploymentTenantCleanupEventsRelations = relations(deploymentTenantCleanupEvents, ({one}) => ({
	run: one(deploymentTenantCleanupRuns, {
		fields: [deploymentTenantCleanupEvents.runId],
		references: [deploymentTenantCleanupRuns.id]
	}),
}));

export const subscriptionPurchaseOrdersRelations = relations(subscriptionPurchaseOrders, ({one, many}) => ({
	workspace: one(workspaces, {
		fields: [subscriptionPurchaseOrders.workspaceId],
		references: [workspaces.id]
	}),
	product: one(products, {
		fields: [subscriptionPurchaseOrders.productId],
		references: [products.id]
	}),
	plan: one(plans, {
		fields: [subscriptionPurchaseOrders.planId],
		references: [plans.id]
	}),
	appInstanceTemplateVersion: one(appInstanceTemplateVersions, {
		fields: [subscriptionPurchaseOrders.templateVersionId],
		references: [appInstanceTemplateVersions.id]
	}),
	subscription_subscriptionId: one(subscriptions, {
		fields: [subscriptionPurchaseOrders.subscriptionId],
		references: [subscriptions.id],
		relationName: "subscriptionPurchaseOrders_subscriptionId_subscriptions_id"
	}),
	subscription_renewalSubscriptionId: one(subscriptions, {
		fields: [subscriptionPurchaseOrders.renewalSubscriptionId],
		references: [subscriptions.id],
		relationName: "subscriptionPurchaseOrders_renewalSubscriptionId_subscriptions_id"
	}),
	paymentRecord: one(paymentRecords, {
		fields: [subscriptionPurchaseOrders.paymentRecordId],
		references: [paymentRecords.id]
	}),
	user: one(users, {
		fields: [subscriptionPurchaseOrders.createdByUserId],
		references: [users.id]
	}),
	paymentWebhookEvents: many(paymentWebhookEvents),
	appInstanceDeployments: many(appInstanceDeployments),
}));

export const paymentWebhookEventsRelations = relations(paymentWebhookEvents, ({one}) => ({
	paymentCheckoutSession: one(paymentCheckoutSessions, {
		fields: [paymentWebhookEvents.checkoutSessionId],
		references: [paymentCheckoutSessions.id]
	}),
	subscriptionPurchaseOrder: one(subscriptionPurchaseOrders, {
		fields: [paymentWebhookEvents.purchaseOrderId],
		references: [subscriptionPurchaseOrders.id]
	}),
}));

export const workspaceMembersRelations = relations(workspaceMembers, ({one}) => ({
	workspace: one(workspaces, {
		fields: [workspaceMembers.workspaceId],
		references: [workspaces.id]
	}),
	user: one(users, {
		fields: [workspaceMembers.userId],
		references: [users.id]
	}),
}));

export const workspaceProductEntitlementsRelations = relations(workspaceProductEntitlements, ({one}) => ({
	workspace: one(workspaces, {
		fields: [workspaceProductEntitlements.workspaceId],
		references: [workspaces.id]
	}),
	product: one(products, {
		fields: [workspaceProductEntitlements.productId],
		references: [products.id]
	}),
	subscription: one(subscriptions, {
		fields: [workspaceProductEntitlements.currentSubscriptionId],
		references: [subscriptions.id]
	}),
	appInstance: one(appInstances, {
		fields: [workspaceProductEntitlements.appInstanceId],
		references: [appInstances.id]
	}),
}));
