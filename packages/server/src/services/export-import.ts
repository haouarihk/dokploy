import { db } from "@dokploy/server/db";
import {
	applications,
	compose,
	domains,
	mariadb,
	mongo,
	mounts,
	mysql,
	ports,
	postgres,
	redirects,
	redis,
	security,
} from "@dokploy/server/db/schema";
import { execAsync, execAsyncRemote } from "@dokploy/server/utils/process/execAsync";
import { TRPCError } from "@trpc/server";
import { eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";

// Types for export/import
export type ServiceType =
	| "application"
	| "postgres"
	| "mysql"
	| "mariadb"
	| "mongo"
	| "redis"
	| "compose";

export interface ServiceIdentifier {
	id: string;
	type: ServiceType;
}

export interface ExportOptions {
	serviceIds?: ServiceIdentifier[];
	includeVolumeData?: boolean;
}

export interface ImportOptions {
	preserveIds?: boolean;
	serverId?: string;
}

export interface ExportedMount {
	mountId: string;
	type: "bind" | "volume" | "file";
	hostPath: string | null;
	volumeName: string | null;
	filePath: string | null;
	content: string | null;
	serviceType: ServiceType;
	mountPath: string;
}

export interface ExportedDomain {
	domainId: string;
	host: string;
	https: boolean;
	port: number | null;
	path: string | null;
	serviceName: string | null;
	domainType: "compose" | "application" | "preview" | null;
	certificateType: "letsencrypt" | "none" | "custom";
	customCertResolver: string | null;
	internalPath: string | null;
	stripPath: boolean;
}

export interface ExportedPort {
	portId: string;
	publishedPort: number;
	publishMode: "ingress" | "host";
	targetPort: number;
	protocol: "tcp" | "udp";
}

export interface ExportedSecurity {
	securityId: string;
	username: string;
	password: string;
}

export interface ExportedRedirect {
	redirectId: string;
	regex: string;
	replacement: string;
	permanent: boolean;
}

export interface ExportedApplication {
	applicationId: string;
	name: string;
	appName: string;
	description: string | null;
	env: string | null;
	buildArgs: string | null;
	buildSecrets: string | null;
	memoryReservation: string | null;
	memoryLimit: string | null;
	cpuReservation: string | null;
	cpuLimit: string | null;
	title: string | null;
	enabled: boolean | null;
	subtitle: string | null;
	command: string | null;
	args: string[] | null;
	sourceType: "docker" | "git" | "github" | "gitlab" | "bitbucket" | "gitea" | "drop";
	cleanCache: boolean | null;
	repository: string | null;
	owner: string | null;
	branch: string | null;
	buildPath: string | null;
	autoDeploy: boolean | null;
	dockerImage: string | null;
	dockerfile: string | null;
	buildType: "dockerfile" | "heroku_buildpacks" | "paketo_buildpacks" | "nixpacks" | "static" | "railpack";
	publishDirectory: string | null;
	replicas: number;
	// Related data
	domains: ExportedDomain[];
	mounts: ExportedMount[];
	ports: ExportedPort[];
	security: ExportedSecurity[];
	redirects: ExportedRedirect[];
}

export interface ExportedDatabase {
	// Common fields
	name: string;
	appName: string;
	description: string | null;
	dockerImage: string;
	command: string | null;
	args: string[] | null;
	env: string | null;
	memoryReservation: string | null;
	memoryLimit: string | null;
	cpuReservation: string | null;
	cpuLimit: string | null;
	externalPort: number | null;
	replicas: number;
	// Mounts
	mounts: ExportedMount[];
}

export interface ExportedPostgres extends ExportedDatabase {
	postgresId: string;
	databaseName: string;
	databaseUser: string;
	databasePassword: string;
}

export interface ExportedMysql extends ExportedDatabase {
	mysqlId: string;
	databaseName: string;
	databaseUser: string;
	databasePassword: string;
	databaseRootPassword: string;
}

export interface ExportedMariadb extends ExportedDatabase {
	mariadbId: string;
	databaseName: string;
	databaseUser: string;
	databasePassword: string;
	databaseRootPassword: string;
}

export interface ExportedMongo extends ExportedDatabase {
	mongoId: string;
	databaseUser: string;
	databasePassword: string;
}

export interface ExportedRedis extends ExportedDatabase {
	redisId: string;
	databasePassword: string;
}

export interface ExportedCompose {
	composeId: string;
	name: string;
	appName: string;
	description: string | null;
	env: string | null;
	composeFile: string;
	sourceType: "git" | "github" | "gitlab" | "bitbucket" | "gitea" | "raw";
	composeType: "docker-compose" | "stack";
	repository: string | null;
	owner: string | null;
	branch: string | null;
	autoDeploy: boolean | null;
	command: string;
	composePath: string;
	// Related data
	domains: ExportedDomain[];
	mounts: ExportedMount[];
}

export interface ExportData {
	version: string;
	exportedAt: string;
	includesVolumeData: boolean;
	services: {
		applications: ExportedApplication[];
		postgres: ExportedPostgres[];
		mysql: ExportedMysql[];
		mariadb: ExportedMariadb[];
		mongo: ExportedMongo[];
		redis: ExportedRedis[];
		compose: ExportedCompose[];
	};
	volumeData: Record<string, string>; // volumeName -> base64 tar.gz data
}

export interface ImportResult {
	success: boolean;
	imported: {
		applications: number;
		postgres: number;
		mysql: number;
		mariadb: number;
		mongo: number;
		redis: number;
		compose: number;
	};
	errors: string[];
	idMappings: Record<string, string>; // oldId -> newId
}

/**
 * Export volume data as base64-encoded tar.gz
 */
async function exportVolumeData(
	volumeName: string,
	serverId?: string | null,
): Promise<string | null> {
	try {
		const command = `docker run --rm -v ${volumeName}:/data alpine sh -c "cd /data && tar -czf - ." | base64 -w 0`;
		
		let result: { stdout: string; stderr: string };
		if (serverId) {
			result = await execAsyncRemote(serverId, command);
		} else {
			result = await execAsync(command);
		}
		
		return result.stdout.trim();
	} catch (error) {
		console.error(`Failed to export volume ${volumeName}:`, error);
		return null;
	}
}

/**
 * Import volume data from base64-encoded tar.gz
 */
async function importVolumeData(
	volumeName: string,
	data: string,
	serverId?: string | null,
): Promise<boolean> {
	try {
		// Create volume first
		const createCommand = `docker volume create ${volumeName}`;
		if (serverId) {
			await execAsyncRemote(serverId, createCommand);
		} else {
			await execAsync(createCommand);
		}

		// Import data
		const importCommand = `echo "${data}" | base64 -d | docker run --rm -i -v ${volumeName}:/data alpine sh -c "cd /data && tar -xzf -"`;
		if (serverId) {
			await execAsyncRemote(serverId, importCommand);
		} else {
			await execAsync(importCommand);
		}
		
		return true;
	} catch (error) {
		console.error(`Failed to import volume ${volumeName}:`, error);
		return false;
	}
}

/**
 * Check if an ID already exists in the database
 */
async function checkIdExists(id: string, type: ServiceType): Promise<boolean> {
	switch (type) {
		case "application": {
			const app = await db.query.applications.findFirst({
				where: eq(applications.applicationId, id),
			});
			return !!app;
		}
		case "postgres": {
			const pg = await db.query.postgres.findFirst({
				where: eq(postgres.postgresId, id),
			});
			return !!pg;
		}
		case "mysql": {
			const my = await db.query.mysql.findFirst({
				where: eq(mysql.mysqlId, id),
			});
			return !!my;
		}
		case "mariadb": {
			const maria = await db.query.mariadb.findFirst({
				where: eq(mariadb.mariadbId, id),
			});
			return !!maria;
		}
		case "mongo": {
			const mon = await db.query.mongo.findFirst({
				where: eq(mongo.mongoId, id),
			});
			return !!mon;
		}
		case "redis": {
			const red = await db.query.redis.findFirst({
				where: eq(redis.redisId, id),
			});
			return !!red;
		}
		case "compose": {
			const comp = await db.query.compose.findFirst({
				where: eq(compose.composeId, id),
			});
			return !!comp;
		}
		default:
			return false;
	}
}

/**
 * Export services from an environment
 */
export async function exportServices(
	environmentId: string,
	options: ExportOptions = {},
): Promise<ExportData> {
	const { serviceIds, includeVolumeData = false } = options;

	// Build the export data structure
	const exportData: ExportData = {
		version: "1.0",
		exportedAt: new Date().toISOString(),
		includesVolumeData,
		services: {
			applications: [],
			postgres: [],
			mysql: [],
			mariadb: [],
			mongo: [],
			redis: [],
			compose: [],
		},
		volumeData: {},
	};

	// Collect all volume names for potential export
	const volumesToExport: { name: string; serverId: string | null }[] = [];

	// Get filter IDs by type
	const filterIds = (type: ServiceType) =>
		serviceIds?.filter((s) => s.type === type).map((s) => s.id);

	// Export Applications
	const appIds = filterIds("application");
	const appsQuery = appIds?.length
		? db.query.applications.findMany({
				where: inArray(applications.applicationId, appIds),
				with: {
					domains: true,
					mounts: true,
					ports: true,
					security: true,
					redirects: true,
					server: true,
				},
			})
		: db.query.applications.findMany({
				where: eq(applications.environmentId, environmentId),
				with: {
					domains: true,
					mounts: true,
					ports: true,
					security: true,
					redirects: true,
					server: true,
				},
			});

	const apps = await appsQuery;
	for (const app of apps) {
		exportData.services.applications.push({
			applicationId: app.applicationId,
			name: app.name,
			appName: app.appName,
			description: app.description,
			env: app.env,
			buildArgs: app.buildArgs,
			buildSecrets: app.buildSecrets,
			memoryReservation: app.memoryReservation,
			memoryLimit: app.memoryLimit,
			cpuReservation: app.cpuReservation,
			cpuLimit: app.cpuLimit,
			title: app.title,
			enabled: app.enabled,
			subtitle: app.subtitle,
			command: app.command,
			args: app.args,
			sourceType: app.sourceType,
			cleanCache: app.cleanCache,
			repository: app.repository,
			owner: app.owner,
			branch: app.branch,
			buildPath: app.buildPath,
			autoDeploy: app.autoDeploy,
			dockerImage: app.dockerImage,
			dockerfile: app.dockerfile,
			buildType: app.buildType,
			publishDirectory: app.publishDirectory,
			replicas: app.replicas,
			domains: app.domains.map((d) => ({
				domainId: d.domainId,
				host: d.host,
				https: d.https,
				port: d.port,
				path: d.path,
				serviceName: d.serviceName,
				domainType: d.domainType,
				certificateType: d.certificateType,
				customCertResolver: d.customCertResolver,
				internalPath: d.internalPath,
				stripPath: d.stripPath,
			})),
			mounts: app.mounts.map((m) => ({
				mountId: m.mountId,
				type: m.type,
				hostPath: m.hostPath,
				volumeName: m.volumeName,
				filePath: m.filePath,
				content: m.content,
				serviceType: m.serviceType as ServiceType,
				mountPath: m.mountPath,
			})),
			ports: app.ports.map((p) => ({
				portId: p.portId,
				publishedPort: p.publishedPort,
				publishMode: p.publishMode,
				targetPort: p.targetPort,
				protocol: p.protocol,
			})),
			security: app.security.map((s) => ({
				securityId: s.securityId,
				username: s.username,
				password: s.password,
			})),
			redirects: app.redirects.map((r) => ({
				redirectId: r.redirectId,
				regex: r.regex,
				replacement: r.replacement,
				permanent: r.permanent,
			})),
		});

		// Collect volumes
		for (const mount of app.mounts) {
			if (mount.type === "volume" && mount.volumeName) {
				volumesToExport.push({
					name: mount.volumeName,
					serverId: app.serverId,
				});
			}
		}
	}

	// Export Postgres
	const pgIds = filterIds("postgres");
	const pgQuery = pgIds?.length
		? db.query.postgres.findMany({
				where: inArray(postgres.postgresId, pgIds),
				with: { mounts: true, server: true },
			})
		: db.query.postgres.findMany({
				where: eq(postgres.environmentId, environmentId),
				with: { mounts: true, server: true },
			});

	const pgs = await pgQuery;
	for (const pg of pgs) {
		exportData.services.postgres.push({
			postgresId: pg.postgresId,
			name: pg.name,
			appName: pg.appName,
			description: pg.description,
			databaseName: pg.databaseName,
			databaseUser: pg.databaseUser,
			databasePassword: pg.databasePassword,
			dockerImage: pg.dockerImage,
			command: pg.command,
			args: pg.args,
			env: pg.env,
			memoryReservation: pg.memoryReservation,
			memoryLimit: pg.memoryLimit,
			cpuReservation: pg.cpuReservation,
			cpuLimit: pg.cpuLimit,
			externalPort: pg.externalPort,
			replicas: pg.replicas,
			mounts: pg.mounts.map((m) => ({
				mountId: m.mountId,
				type: m.type,
				hostPath: m.hostPath,
				volumeName: m.volumeName,
				filePath: m.filePath,
				content: m.content,
				serviceType: m.serviceType as ServiceType,
				mountPath: m.mountPath,
			})),
		});

		for (const mount of pg.mounts) {
			if (mount.type === "volume" && mount.volumeName) {
				volumesToExport.push({ name: mount.volumeName, serverId: pg.serverId });
			}
		}
	}

	// Export MySQL
	const myIds = filterIds("mysql");
	const myQuery = myIds?.length
		? db.query.mysql.findMany({
				where: inArray(mysql.mysqlId, myIds),
				with: { mounts: true, server: true },
			})
		: db.query.mysql.findMany({
				where: eq(mysql.environmentId, environmentId),
				with: { mounts: true, server: true },
			});

	const mys = await myQuery;
	for (const my of mys) {
		exportData.services.mysql.push({
			mysqlId: my.mysqlId,
			name: my.name,
			appName: my.appName,
			description: my.description,
			databaseName: my.databaseName,
			databaseUser: my.databaseUser,
			databasePassword: my.databasePassword,
			databaseRootPassword: my.databaseRootPassword,
			dockerImage: my.dockerImage,
			command: my.command,
			args: my.args,
			env: my.env,
			memoryReservation: my.memoryReservation,
			memoryLimit: my.memoryLimit,
			cpuReservation: my.cpuReservation,
			cpuLimit: my.cpuLimit,
			externalPort: my.externalPort,
			replicas: my.replicas,
			mounts: my.mounts.map((m) => ({
				mountId: m.mountId,
				type: m.type,
				hostPath: m.hostPath,
				volumeName: m.volumeName,
				filePath: m.filePath,
				content: m.content,
				serviceType: m.serviceType as ServiceType,
				mountPath: m.mountPath,
			})),
		});

		for (const mount of my.mounts) {
			if (mount.type === "volume" && mount.volumeName) {
				volumesToExport.push({ name: mount.volumeName, serverId: my.serverId });
			}
		}
	}

	// Export MariaDB
	const mariaIds = filterIds("mariadb");
	const mariaQuery = mariaIds?.length
		? db.query.mariadb.findMany({
				where: inArray(mariadb.mariadbId, mariaIds),
				with: { mounts: true, server: true },
			})
		: db.query.mariadb.findMany({
				where: eq(mariadb.environmentId, environmentId),
				with: { mounts: true, server: true },
			});

	const marias = await mariaQuery;
	for (const maria of marias) {
		exportData.services.mariadb.push({
			mariadbId: maria.mariadbId,
			name: maria.name,
			appName: maria.appName,
			description: maria.description,
			databaseName: maria.databaseName,
			databaseUser: maria.databaseUser,
			databasePassword: maria.databasePassword,
			databaseRootPassword: maria.databaseRootPassword,
			dockerImage: maria.dockerImage,
			command: maria.command,
			args: maria.args,
			env: maria.env,
			memoryReservation: maria.memoryReservation,
			memoryLimit: maria.memoryLimit,
			cpuReservation: maria.cpuReservation,
			cpuLimit: maria.cpuLimit,
			externalPort: maria.externalPort,
			replicas: maria.replicas,
			mounts: maria.mounts.map((m) => ({
				mountId: m.mountId,
				type: m.type,
				hostPath: m.hostPath,
				volumeName: m.volumeName,
				filePath: m.filePath,
				content: m.content,
				serviceType: m.serviceType as ServiceType,
				mountPath: m.mountPath,
			})),
		});

		for (const mount of maria.mounts) {
			if (mount.type === "volume" && mount.volumeName) {
				volumesToExport.push({
					name: mount.volumeName,
					serverId: maria.serverId,
				});
			}
		}
	}

	// Export MongoDB
	const monIds = filterIds("mongo");
	const monQuery = monIds?.length
		? db.query.mongo.findMany({
				where: inArray(mongo.mongoId, monIds),
				with: { mounts: true, server: true },
			})
		: db.query.mongo.findMany({
				where: eq(mongo.environmentId, environmentId),
				with: { mounts: true, server: true },
			});

	const mons = await monQuery;
	for (const mon of mons) {
		exportData.services.mongo.push({
			mongoId: mon.mongoId,
			name: mon.name,
			appName: mon.appName,
			description: mon.description,
			databaseUser: mon.databaseUser,
			databasePassword: mon.databasePassword,
			dockerImage: mon.dockerImage,
			command: mon.command,
			args: mon.args,
			env: mon.env,
			memoryReservation: mon.memoryReservation,
			memoryLimit: mon.memoryLimit,
			cpuReservation: mon.cpuReservation,
			cpuLimit: mon.cpuLimit,
			externalPort: mon.externalPort,
			replicas: mon.replicas,
			mounts: mon.mounts.map((m) => ({
				mountId: m.mountId,
				type: m.type,
				hostPath: m.hostPath,
				volumeName: m.volumeName,
				filePath: m.filePath,
				content: m.content,
				serviceType: m.serviceType as ServiceType,
				mountPath: m.mountPath,
			})),
		});

		for (const mount of mon.mounts) {
			if (mount.type === "volume" && mount.volumeName) {
				volumesToExport.push({ name: mount.volumeName, serverId: mon.serverId });
			}
		}
	}

	// Export Redis
	const redIds = filterIds("redis");
	const redQuery = redIds?.length
		? db.query.redis.findMany({
				where: inArray(redis.redisId, redIds),
				with: { mounts: true, server: true },
			})
		: db.query.redis.findMany({
				where: eq(redis.environmentId, environmentId),
				with: { mounts: true, server: true },
			});

	const reds = await redQuery;
	for (const red of reds) {
		exportData.services.redis.push({
			redisId: red.redisId,
			name: red.name,
			appName: red.appName,
			description: red.description,
			databasePassword: red.databasePassword,
			dockerImage: red.dockerImage,
			command: red.command,
			args: red.args,
			env: red.env,
			memoryReservation: red.memoryReservation,
			memoryLimit: red.memoryLimit,
			cpuReservation: red.cpuReservation,
			cpuLimit: red.cpuLimit,
			externalPort: red.externalPort,
			replicas: red.replicas,
			mounts: red.mounts.map((m) => ({
				mountId: m.mountId,
				type: m.type,
				hostPath: m.hostPath,
				volumeName: m.volumeName,
				filePath: m.filePath,
				content: m.content,
				serviceType: m.serviceType as ServiceType,
				mountPath: m.mountPath,
			})),
		});

		for (const mount of red.mounts) {
			if (mount.type === "volume" && mount.volumeName) {
				volumesToExport.push({ name: mount.volumeName, serverId: red.serverId });
			}
		}
	}

	// Export Compose
	const compIds = filterIds("compose");
	const compQuery = compIds?.length
		? db.query.compose.findMany({
				where: inArray(compose.composeId, compIds),
				with: { domains: true, mounts: true, server: true },
			})
		: db.query.compose.findMany({
				where: eq(compose.environmentId, environmentId),
				with: { domains: true, mounts: true, server: true },
			});

	const comps = await compQuery;
	for (const comp of comps) {
		exportData.services.compose.push({
			composeId: comp.composeId,
			name: comp.name,
			appName: comp.appName,
			description: comp.description,
			env: comp.env,
			composeFile: comp.composeFile,
			sourceType: comp.sourceType,
			composeType: comp.composeType,
			repository: comp.repository,
			owner: comp.owner,
			branch: comp.branch,
			autoDeploy: comp.autoDeploy,
			command: comp.command,
			composePath: comp.composePath,
			domains: comp.domains.map((d) => ({
				domainId: d.domainId,
				host: d.host,
				https: d.https,
				port: d.port,
				path: d.path,
				serviceName: d.serviceName,
				domainType: d.domainType,
				certificateType: d.certificateType,
				customCertResolver: d.customCertResolver,
				internalPath: d.internalPath,
				stripPath: d.stripPath,
			})),
			mounts: comp.mounts.map((m) => ({
				mountId: m.mountId,
				type: m.type,
				hostPath: m.hostPath,
				volumeName: m.volumeName,
				filePath: m.filePath,
				content: m.content,
				serviceType: m.serviceType as ServiceType,
				mountPath: m.mountPath,
			})),
		});

		for (const mount of comp.mounts) {
			if (mount.type === "volume" && mount.volumeName) {
				volumesToExport.push({
					name: mount.volumeName,
					serverId: comp.serverId,
				});
			}
		}
	}

	// Export volume data if requested
	if (includeVolumeData) {
		const uniqueVolumes = new Map<string, string | null>();
		for (const vol of volumesToExport) {
			if (!uniqueVolumes.has(vol.name)) {
				uniqueVolumes.set(vol.name, vol.serverId);
			}
		}

		for (const [volumeName, serverId] of uniqueVolumes) {
			const data = await exportVolumeData(volumeName, serverId);
			if (data) {
				exportData.volumeData[volumeName] = data;
			}
		}
	}

	return exportData;
}

/**
 * Import services into an environment
 */
export async function importServices(
	data: ExportData,
	targetEnvironmentId: string,
	options: ImportOptions = {},
): Promise<ImportResult> {
	const { preserveIds = true, serverId } = options;

	const result: ImportResult = {
		success: true,
		imported: {
			applications: 0,
			postgres: 0,
			mysql: 0,
			mariadb: 0,
			mongo: 0,
			redis: 0,
			compose: 0,
		},
		errors: [],
		idMappings: {},
	};

	// Helper to generate new ID or use existing
	const getNewId = async (
		originalId: string,
		type: ServiceType,
	): Promise<string> => {
		if (preserveIds) {
			const exists = await checkIdExists(originalId, type);
			if (!exists) {
				return originalId;
			}
		}
		const newId = nanoid();
		result.idMappings[originalId] = newId;
		return newId;
	};

	// Helper to generate unique appName
	const generateUniqueAppName = async (baseName: string): Promise<string> => {
		// Extract the base name without the suffix
		const baseWithoutSuffix = baseName.replace(/-[a-z0-9]+$/, "");
		let appName = `${baseWithoutSuffix}-${nanoid(6).toLowerCase()}`;
		
		// Check if it's unique (simplified check)
		return appName;
	};

	// Import volume data first if included
	if (data.includesVolumeData && Object.keys(data.volumeData).length > 0) {
		for (const [volumeName, volumeDataStr] of Object.entries(data.volumeData)) {
			const success = await importVolumeData(volumeName, volumeDataStr, serverId);
			if (!success) {
				result.errors.push(`Failed to import volume: ${volumeName}`);
			}
		}
	}

	// Import Applications
	for (const app of data.services.applications) {
		try {
			const newId = await getNewId(app.applicationId, "application");
			const newAppName = await generateUniqueAppName(app.appName);

			const [newApp] = await db
				.insert(applications)
				.values({
					applicationId: newId,
					name: app.name,
					appName: newAppName,
					description: app.description,
					env: app.env,
					buildArgs: app.buildArgs,
					buildSecrets: app.buildSecrets,
					memoryReservation: app.memoryReservation,
					memoryLimit: app.memoryLimit,
					cpuReservation: app.cpuReservation,
					cpuLimit: app.cpuLimit,
					title: app.title,
					enabled: app.enabled,
					subtitle: app.subtitle,
					command: app.command,
					args: app.args,
					sourceType: app.sourceType,
					cleanCache: app.cleanCache,
					repository: app.repository,
					owner: app.owner,
					branch: app.branch,
					buildPath: app.buildPath,
					autoDeploy: app.autoDeploy,
					dockerImage: app.dockerImage,
					dockerfile: app.dockerfile,
					buildType: app.buildType,
					publishDirectory: app.publishDirectory,
					replicas: app.replicas,
					environmentId: targetEnvironmentId,
					serverId: serverId || null,
					applicationStatus: "idle",
				})
				.returning();

			// Import domains
			for (const domain of app.domains) {
				await db.insert(domains).values({
					domainId: nanoid(),
					host: domain.host,
					https: domain.https,
					port: domain.port,
					path: domain.path,
					serviceName: domain.serviceName,
					domainType: "application",
					certificateType: domain.certificateType,
					customCertResolver: domain.customCertResolver,
					internalPath: domain.internalPath,
					stripPath: domain.stripPath,
					applicationId: newId,
				});
			}

			// Import mounts
			for (const mount of app.mounts) {
				await db.insert(mounts).values({
					mountId: nanoid(),
					type: mount.type,
					hostPath: mount.hostPath,
					volumeName: mount.volumeName,
					filePath: mount.filePath,
					content: mount.content,
					serviceType: "application",
					mountPath: mount.mountPath,
					applicationId: newId,
				});
			}

			// Import ports
			for (const port of app.ports) {
				await db.insert(ports).values({
					portId: nanoid(),
					publishedPort: port.publishedPort,
					publishMode: port.publishMode,
					targetPort: port.targetPort,
					protocol: port.protocol,
					applicationId: newId,
				});
			}

			// Import security
			for (const sec of app.security) {
				await db.insert(security).values({
					securityId: nanoid(),
					username: sec.username,
					password: sec.password,
					applicationId: newId,
				});
			}

			// Import redirects
			for (const redirect of app.redirects) {
				await db.insert(redirects).values({
					redirectId: nanoid(),
					regex: redirect.regex,
					replacement: redirect.replacement,
					permanent: redirect.permanent,
					applicationId: newId,
				});
			}

			result.imported.applications++;
		} catch (error) {
			result.errors.push(
				`Failed to import application ${app.name}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	// Import Postgres
	for (const pg of data.services.postgres) {
		try {
			const newId = await getNewId(pg.postgresId, "postgres");
			const newAppName = await generateUniqueAppName(pg.appName);

			await db.insert(postgres).values({
				postgresId: newId,
				name: pg.name,
				appName: newAppName,
				description: pg.description,
				databaseName: pg.databaseName,
				databaseUser: pg.databaseUser,
				databasePassword: pg.databasePassword,
				dockerImage: pg.dockerImage,
				command: pg.command,
				args: pg.args,
				env: pg.env,
				memoryReservation: pg.memoryReservation,
				memoryLimit: pg.memoryLimit,
				cpuReservation: pg.cpuReservation,
				cpuLimit: pg.cpuLimit,
				externalPort: pg.externalPort,
				replicas: pg.replicas,
				environmentId: targetEnvironmentId,
				serverId: serverId || null,
				applicationStatus: "idle",
			});

			for (const mount of pg.mounts) {
				await db.insert(mounts).values({
					mountId: nanoid(),
					type: mount.type,
					hostPath: mount.hostPath,
					volumeName: mount.volumeName,
					filePath: mount.filePath,
					content: mount.content,
					serviceType: "postgres",
					mountPath: mount.mountPath,
					postgresId: newId,
				});
			}

			result.imported.postgres++;
		} catch (error) {
			result.errors.push(
				`Failed to import postgres ${pg.name}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	// Import MySQL
	for (const my of data.services.mysql) {
		try {
			const newId = await getNewId(my.mysqlId, "mysql");
			const newAppName = await generateUniqueAppName(my.appName);

			await db.insert(mysql).values({
				mysqlId: newId,
				name: my.name,
				appName: newAppName,
				description: my.description,
				databaseName: my.databaseName,
				databaseUser: my.databaseUser,
				databasePassword: my.databasePassword,
				databaseRootPassword: my.databaseRootPassword,
				dockerImage: my.dockerImage,
				command: my.command,
				args: my.args,
				env: my.env,
				memoryReservation: my.memoryReservation,
				memoryLimit: my.memoryLimit,
				cpuReservation: my.cpuReservation,
				cpuLimit: my.cpuLimit,
				externalPort: my.externalPort,
				replicas: my.replicas,
				environmentId: targetEnvironmentId,
				serverId: serverId || null,
				applicationStatus: "idle",
			});

			for (const mount of my.mounts) {
				await db.insert(mounts).values({
					mountId: nanoid(),
					type: mount.type,
					hostPath: mount.hostPath,
					volumeName: mount.volumeName,
					filePath: mount.filePath,
					content: mount.content,
					serviceType: "mysql",
					mountPath: mount.mountPath,
					mysqlId: newId,
				});
			}

			result.imported.mysql++;
		} catch (error) {
			result.errors.push(
				`Failed to import mysql ${my.name}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	// Import MariaDB
	for (const maria of data.services.mariadb) {
		try {
			const newId = await getNewId(maria.mariadbId, "mariadb");
			const newAppName = await generateUniqueAppName(maria.appName);

			await db.insert(mariadb).values({
				mariadbId: newId,
				name: maria.name,
				appName: newAppName,
				description: maria.description,
				databaseName: maria.databaseName,
				databaseUser: maria.databaseUser,
				databasePassword: maria.databasePassword,
				databaseRootPassword: maria.databaseRootPassword,
				dockerImage: maria.dockerImage,
				command: maria.command,
				args: maria.args,
				env: maria.env,
				memoryReservation: maria.memoryReservation,
				memoryLimit: maria.memoryLimit,
				cpuReservation: maria.cpuReservation,
				cpuLimit: maria.cpuLimit,
				externalPort: maria.externalPort,
				replicas: maria.replicas,
				environmentId: targetEnvironmentId,
				serverId: serverId || null,
				applicationStatus: "idle",
			});

			for (const mount of maria.mounts) {
				await db.insert(mounts).values({
					mountId: nanoid(),
					type: mount.type,
					hostPath: mount.hostPath,
					volumeName: mount.volumeName,
					filePath: mount.filePath,
					content: mount.content,
					serviceType: "mariadb",
					mountPath: mount.mountPath,
					mariadbId: newId,
				});
			}

			result.imported.mariadb++;
		} catch (error) {
			result.errors.push(
				`Failed to import mariadb ${maria.name}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	// Import MongoDB
	for (const mon of data.services.mongo) {
		try {
			const newId = await getNewId(mon.mongoId, "mongo");
			const newAppName = await generateUniqueAppName(mon.appName);

			await db.insert(mongo).values({
				mongoId: newId,
				name: mon.name,
				appName: newAppName,
				description: mon.description,
				databaseUser: mon.databaseUser,
				databasePassword: mon.databasePassword,
				dockerImage: mon.dockerImage,
				command: mon.command,
				args: mon.args,
				env: mon.env,
				memoryReservation: mon.memoryReservation,
				memoryLimit: mon.memoryLimit,
				cpuReservation: mon.cpuReservation,
				cpuLimit: mon.cpuLimit,
				externalPort: mon.externalPort,
				replicas: mon.replicas,
				environmentId: targetEnvironmentId,
				serverId: serverId || null,
				applicationStatus: "idle",
			});

			for (const mount of mon.mounts) {
				await db.insert(mounts).values({
					mountId: nanoid(),
					type: mount.type,
					hostPath: mount.hostPath,
					volumeName: mount.volumeName,
					filePath: mount.filePath,
					content: mount.content,
					serviceType: "mongo",
					mountPath: mount.mountPath,
					mongoId: newId,
				});
			}

			result.imported.mongo++;
		} catch (error) {
			result.errors.push(
				`Failed to import mongo ${mon.name}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	// Import Redis
	for (const red of data.services.redis) {
		try {
			const newId = await getNewId(red.redisId, "redis");
			const newAppName = await generateUniqueAppName(red.appName);

			await db.insert(redis).values({
				redisId: newId,
				name: red.name,
				appName: newAppName,
				description: red.description,
				databasePassword: red.databasePassword,
				dockerImage: red.dockerImage,
				command: red.command,
				args: red.args,
				env: red.env,
				memoryReservation: red.memoryReservation,
				memoryLimit: red.memoryLimit,
				cpuReservation: red.cpuReservation,
				cpuLimit: red.cpuLimit,
				externalPort: red.externalPort,
				replicas: red.replicas,
				environmentId: targetEnvironmentId,
				serverId: serverId || null,
				applicationStatus: "idle",
			});

			for (const mount of red.mounts) {
				await db.insert(mounts).values({
					mountId: nanoid(),
					type: mount.type,
					hostPath: mount.hostPath,
					volumeName: mount.volumeName,
					filePath: mount.filePath,
					content: mount.content,
					serviceType: "redis",
					mountPath: mount.mountPath,
					redisId: newId,
				});
			}

			result.imported.redis++;
		} catch (error) {
			result.errors.push(
				`Failed to import redis ${red.name}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	// Import Compose
	for (const comp of data.services.compose) {
		try {
			const newId = await getNewId(comp.composeId, "compose");
			const newAppName = await generateUniqueAppName(comp.appName);

			await db.insert(compose).values({
				composeId: newId,
				name: comp.name,
				appName: newAppName,
				description: comp.description,
				env: comp.env,
				composeFile: comp.composeFile,
				sourceType: comp.sourceType,
				composeType: comp.composeType,
				repository: comp.repository,
				owner: comp.owner,
				branch: comp.branch,
				autoDeploy: comp.autoDeploy,
				command: comp.command,
				composePath: comp.composePath,
				environmentId: targetEnvironmentId,
				serverId: serverId || null,
				composeStatus: "idle",
			});

			for (const domain of comp.domains) {
				await db.insert(domains).values({
					domainId: nanoid(),
					host: domain.host,
					https: domain.https,
					port: domain.port,
					path: domain.path,
					serviceName: domain.serviceName,
					domainType: "compose",
					certificateType: domain.certificateType,
					customCertResolver: domain.customCertResolver,
					internalPath: domain.internalPath,
					stripPath: domain.stripPath,
					composeId: newId,
				});
			}

			for (const mount of comp.mounts) {
				await db.insert(mounts).values({
					mountId: nanoid(),
					type: mount.type,
					hostPath: mount.hostPath,
					volumeName: mount.volumeName,
					filePath: mount.filePath,
					content: mount.content,
					serviceType: "compose",
					mountPath: mount.mountPath,
					composeId: newId,
				});
			}

			result.imported.compose++;
		} catch (error) {
			result.errors.push(
				`Failed to import compose ${comp.name}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	result.success = result.errors.length === 0;
	return result;
}
