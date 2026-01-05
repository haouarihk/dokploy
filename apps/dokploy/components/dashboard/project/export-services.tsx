import { Download, Loader2 } from "lucide-react";
import { useState } from "react";
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
import { Label } from "@/components/ui/label";
import { api } from "@/utils/api";

export type ServiceItem = {
	id: string;
	name: string;
	type:
		| "application"
		| "postgres"
		| "mysql"
		| "mariadb"
		| "mongo"
		| "redis"
		| "compose";
};

interface ExportServicesProps {
	environmentId: string;
	services: ServiceItem[];
	selectedServiceIds: string[];
}

export const ExportServices = ({
	environmentId,
	services,
	selectedServiceIds,
}: ExportServicesProps) => {
	const [open, setOpen] = useState(false);
	const [includeVolumeData, setIncludeVolumeData] = useState(false);

	const selectedServices = services.filter((service) =>
		selectedServiceIds.includes(service.id),
	);

	const { mutateAsync: exportMutation, isLoading } =
		api.project.export.useMutation({
			onSuccess: (data) => {
				// Create and download JSON file
				const blob = new Blob([JSON.stringify(data, null, 2)], {
					type: "application/json",
				});
				const url = URL.createObjectURL(blob);
				const link = document.createElement("a");
				link.href = url;
				link.download = `dokploy-export-${new Date().toISOString().split("T")[0]}.json`;
				document.body.appendChild(link);
				link.click();
				document.body.removeChild(link);
				URL.revokeObjectURL(url);

				toast.success(
					`Exported ${selectedServices.length} service${selectedServices.length !== 1 ? "s" : ""} successfully`,
				);
				setOpen(false);
			},
			onError: (error) => {
				toast.error(`Export failed: ${error.message}`);
			},
		});

	const handleExport = async () => {
		await exportMutation({
			environmentId,
			serviceIds: selectedServices.map((s) => ({
				id: s.id,
				type: s.type,
			})),
			includeVolumeData,
		});
	};

	return (
		<Dialog
			open={open}
			onOpenChange={(isOpen) => {
				setOpen(isOpen);
				if (!isOpen) {
					setIncludeVolumeData(false);
				}
			}}
		>
			<DialogTrigger asChild>
				<Button variant="ghost" className="w-full justify-start">
					<Download className="mr-2 h-4 w-4" />
					Export
				</Button>
			</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Export Services</DialogTitle>
					<DialogDescription>
						Export the selected services as a JSON file. This file can be
						imported into another Dokploy instance.
					</DialogDescription>
				</DialogHeader>

				<div className="grid gap-4 py-4">
					<div className="grid gap-2">
						<Label>Services to export ({selectedServices.length})</Label>
						<div className="space-y-2 max-h-[200px] overflow-y-auto border rounded-md p-4">
							{selectedServices.map((service) => (
								<div key={service.id} className="flex items-center space-x-2">
									<span className="px-2 py-1 text-xs bg-secondary rounded">
										{service.type}
									</span>
									<span className="text-sm">{service.name}</span>
								</div>
							))}
						</div>
					</div>

					<div className="flex items-center space-x-2">
						<Checkbox
							id="includeVolumeData"
							checked={includeVolumeData}
							onCheckedChange={(checked) =>
								setIncludeVolumeData(checked === true)
							}
						/>
						<div className="grid gap-1.5 leading-none">
							<Label
								htmlFor="includeVolumeData"
								className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
							>
								Include volume data
							</Label>
							<p className="text-xs text-muted-foreground">
								Export actual Docker volume contents. This will result in a
								larger file but allows full data migration.
							</p>
						</div>
					</div>

					<div className="rounded-md bg-muted p-3 text-sm">
						<p className="font-medium mb-2">The export will include:</p>
						<ul className="list-disc list-inside space-y-1 text-muted-foreground text-xs">
							<li>Service configurations and environment variables</li>
							<li>Domains, ports, and redirects</li>
							<li>Mount configurations and file mount contents</li>
							<li>Security settings (basic auth)</li>
							{includeVolumeData && (
								<li className="text-primary">
									Actual volume data (compressed)
								</li>
							)}
						</ul>
						<p className="mt-2 text-xs text-muted-foreground">
							<strong>Not included:</strong> Git provider tokens, registry
							passwords, deployment history
						</p>
					</div>
				</div>

				<DialogFooter>
					<Button
						variant="outline"
						onClick={() => setOpen(false)}
						disabled={isLoading}
					>
						Cancel
					</Button>
					<Button onClick={handleExport} disabled={isLoading}>
						{isLoading ? (
							<>
								<Loader2 className="mr-2 h-4 w-4 animate-spin" />
								{includeVolumeData ? "Exporting with volumes..." : "Exporting..."}
							</>
						) : (
							<>
								<Download className="mr-2 h-4 w-4" />
								Export
							</>
						)}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
};
