// Re-export facade — all logic lives in domain submodules.
// Import directly from those paths in new code; these re-exports maintain
// backwards compatibility for existing consumers during migration.
export * from "@/domain/inventory/items/itemSeeding";
export * from "@/domain/inventory/items/itemView";
export * from "@/domain/inventory/display/sessionDisplayHelpers";
export * from "@/domain/inventory/display/listMetadata";
