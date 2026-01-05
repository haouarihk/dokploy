import { Upload, Loader2, FileJson, AlertCircle, CheckCircle2 } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { api } from "@/utils/api";

interface ExportData {
	version: string;
	exportedAt: string;
	includesVolumeData: boolean;
	services: {
		applications: Array<{ applicationId: string; name: string }>;
		postgres: Array<{ postgresId: string; name: string }>;
		mysql: Array<{ mysqlId: string; name: string }>;
		mariadb: Array<{ mariadbId: string; name: string }>;
		mongo: Array<{ mongoId: string; name: string }>;
		redis: Array<{ redisId: string; name: string }>;
		compose: Array<{ composeId: string; name: string }>;
	};
	volumeData: Record<string, string>;
}

interface ImportResult {
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
	idMappings: Record<string, string>;
}

interface ImportServicesProps {
	environmentId: string;
	onSuccess?: () => void;
}

export const ImportServices = ({
	environmentId,
	onSuccess,
}: ImportServicesProps) => {
	const [open, setOpen] = useState(false);
	const [preserveIds, setPreserveIds] = useState(true);
	const [importData, setImportData] = useState<ExportData | null>(null);
	const [fileName, setFileName] = useState<string>("");
	const [parseError, setParseError] = useState<string>("");
	const [importResult, setImportResult] = useState<ImportResult | null>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);
	const utils = api.useUtils();

	const { mutateAsync: importMutation, isLoading } =
		api.project.import.useMutation({
			onSuccess: async (result) => {
				setImportResult(result);
				if (result.success) {
					toast.success("Services imported successfully");
					await utils.environment.one.invalidate({ environmentId });
					onSuccess?.();
				} else if (result.errors.length > 0) {
					toast.warning(`Import completed with ${result.errors.length} errors`);
				}
			},
			onError: (error) => {
				toast.error(`Import failed: ${error.message}`);
			},
		});

	const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
		const file = event.target.files?.[0];
		if (!file) return;

		setFileName(file.name);
		setParseError("");
		setImportResult(null);

		const reader = new FileReader();
		reader.onload = (e) => {
			try {
				const content = e.target?.result as string;
				const data = JSON.parse(content) as ExportData;

				// Validate structure
				if (!data.version || !data.services) {
					throw new Error("Invalid export file format");
				}

				setImportData(data);
			} catch (error) {
				setParseError(
					error instanceof Error ? error.message : "Failed to parse file",
				);
				setImportData(null);
			}
		};
		reader.readAsText(file);
	};

	const handleImport = async () => {
		if (!importData) return;

		await importMutation({
			targetEnvironmentId: environmentId,
			data: importData,
			preserveIds,
		});
	};

	const resetState = () => {
		setImportData(null);
		setFileName("");
		setParseError("");
		setImportResult(null);
		if (fileInputRef.current) {
			fileInputRef.current.value = "";
		}
	};

	const getTotalServices = (data: ExportData) => {
		return (
			data.services.applications.length +
			data.services.postgres.length +
			data.services.mysql.length +
			data.services.mariadb.length +
			data.services.mongo.length +
			data.services.redis.length +
			data.services.compose.length
		);
	};

	const getTotalImported = (result: ImportResult) => {
		return (
			result.imported.applications +
			result.imported.postgres +
			result.imported.mysql +
			result.imported.mariadb +
			result.imported.mongo +
			result.imported.redis +
			result.imported.compose
		);
	};

	return (
		<Dialog
			open={open}
			onOpenChange={(isOpen) => {
				setOpen(isOpen);
				if (!isOpen) {
					resetState();
				}
			}}
		>
			<DialogTrigger asChild>
				<DropdownMenuItem
					className="w-full cursor-pointer space-x-3"
					onSelect={(e) => e.preventDefault()}
				>
					<Upload className="h-4 w-4" />
					<span>Import Services</span>
				</DropdownMenuItem>
			</DialogTrigger>
			<DialogContent className="max-w-lg">
				<DialogHeader>
					<DialogTitle>Import Services</DialogTitle>
					<DialogDescription>
						Import services from a Dokploy export file. Services will be created
						in the current environment.
					</DialogDescription>
				</DialogHeader>

				<div className="grid gap-4 py-4">
					{/* File Upload */}
					<div className="grid gap-2">
						<Label>Select export file</Label>
						<input
							ref={fileInputRef}
							type="file"
							accept=".json"
							onChange={handleFileSelect}
							className="hidden"
						/>
						<Button
							variant="outline"
							onClick={() => fileInputRef.current?.click()}
							className="w-full justify-start"
						>
							<FileJson className="mr-2 h-4 w-4" />
							{fileName || "Choose JSON file..."}
						</Button>
					</div>

					{/* Parse Error */}
					{parseError && (
						<div className="flex items-center gap-2 p-3 bg-destructive/10 text-destructive rounded-md text-sm">
							<AlertCircle className="h-4 w-4" />
							{parseError}
						</div>
					)}

					{/* Preview */}
					{importData && !importResult && (
						<>
							<div className="rounded-md border p-4 space-y-3">
								<div className="flex items-center justify-between text-sm">
									<span className="text-muted-foreground">Export version:</span>
									<span className="font-medium">{importData.version}</span>
								</div>
								<div className="flex items-center justify-between text-sm">
									<span className="text-muted-foreground">Exported at:</span>
									<span className="font-medium">
										{new Date(importData.exportedAt).toLocaleString()}
									</span>
								</div>
								<div className="flex items-center justify-between text-sm">
									<span className="text-muted-foreground">
										Includes volume data:
									</span>
									<span className="font-medium">
										{importData.includesVolumeData ? "Yes" : "No"}
									</span>
								</div>
								<div className="flex items-center justify-between text-sm">
									<span className="text-muted-foreground">Total services:</span>
									<span className="font-medium">
										{getTotalServices(importData)}
									</span>
								</div>
							</div>

							{/* Services breakdown */}
							<div className="space-y-2">
								<Label className="text-sm">Services to import:</Label>
								<div className="grid grid-cols-2 gap-2 text-sm">
									{importData.services.applications.length > 0 && (
										<div className="flex items-center gap-2">
											<span className="px-2 py-1 text-xs bg-secondary rounded">
												application
											</span>
											<span>{importData.services.applications.length}</span>
										</div>
									)}
									{importData.services.postgres.length > 0 && (
										<div className="flex items-center gap-2">
											<span className="px-2 py-1 text-xs bg-secondary rounded">
												postgres
											</span>
											<span>{importData.services.postgres.length}</span>
										</div>
									)}
									{importData.services.mysql.length > 0 && (
										<div className="flex items-center gap-2">
											<span className="px-2 py-1 text-xs bg-secondary rounded">
												mysql
											</span>
											<span>{importData.services.mysql.length}</span>
										</div>
									)}
									{importData.services.mariadb.length > 0 && (
										<div className="flex items-center gap-2">
											<span className="px-2 py-1 text-xs bg-secondary rounded">
												mariadb
											</span>
											<span>{importData.services.mariadb.length}</span>
										</div>
									)}
									{importData.services.mongo.length > 0 && (
										<div className="flex items-center gap-2">
											<span className="px-2 py-1 text-xs bg-secondary rounded">
												mongo
											</span>
											<span>{importData.services.mongo.length}</span>
										</div>
									)}
									{importData.services.redis.length > 0 && (
										<div className="flex items-center gap-2">
											<span className="px-2 py-1 text-xs bg-secondary rounded">
												redis
											</span>
											<span>{importData.services.redis.length}</span>
										</div>
									)}
									{importData.services.compose.length > 0 && (
										<div className="flex items-center gap-2">
											<span className="px-2 py-1 text-xs bg-secondary rounded">
												compose
											</span>
											<span>{importData.services.compose.length}</span>
										</div>
									)}
								</div>
							</div>

							{/* Options */}
							<div className="flex items-center space-x-2">
								<Checkbox
									id="preserveIds"
									checked={preserveIds}
									onCheckedChange={(checked) =>
										setPreserveIds(checked === true)
									}
								/>
								<div className="grid gap-1.5 leading-none">
									<Label
										htmlFor="preserveIds"
										className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
									>
										Preserve original IDs
									</Label>
									<p className="text-xs text-muted-foreground">
										Keep original service IDs if they don't already exist.
										Useful for maintaining references.
									</p>
								</div>
							</div>
						</>
					)}

					{/* Import Result */}
					{importResult && (
						<div className="space-y-3">
							<div
								className={`flex items-center gap-2 p-3 rounded-md text-sm ${
									importResult.success
										? "bg-green-500/10 text-green-500"
										: "bg-yellow-500/10 text-yellow-500"
								}`}
							>
								<CheckCircle2 className="h-4 w-4" />
								<span>
									{getTotalImported(importResult)} service
									{getTotalImported(importResult) !== 1 ? "s" : ""} imported
									{importResult.errors.length > 0 &&
										` with ${importResult.errors.length} error${importResult.errors.length !== 1 ? "s" : ""}`}
								</span>
							</div>

							{importResult.errors.length > 0 && (
								<div className="rounded-md border p-3 max-h-32 overflow-y-auto">
									<p className="text-sm font-medium mb-2">Errors:</p>
									{importResult.errors.map((error, index) => (
										<p
											key={index}
											className="text-xs text-muted-foreground mb-1"
										>
											{error}
										</p>
									))}
								</div>
							)}
						</div>
					)}
				</div>

				<DialogFooter>
					<Button
						variant="outline"
						onClick={() => {
							if (importResult) {
								setOpen(false);
							} else {
								resetState();
							}
						}}
						disabled={isLoading}
					>
						{importResult ? "Close" : "Cancel"}
					</Button>
					{!importResult && (
						<Button
							onClick={handleImport}
							disabled={isLoading || !importData}
						>
							{isLoading ? (
								<>
									<Loader2 className="mr-2 h-4 w-4 animate-spin" />
									Importing...
								</>
							) : (
								<>
									<Upload className="mr-2 h-4 w-4" />
									Import
								</>
							)}
						</Button>
					)}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
};
