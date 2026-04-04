export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      alert_recipients: {
        Row: {
          id: string
          notification_pref_id: string
          user_id: string
        }
        Insert: {
          id?: string
          notification_pref_id: string
          user_id: string
        }
        Update: {
          id?: string
          notification_pref_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "alert_recipients_notification_pref_id_fkey"
            columns: ["notification_pref_id"]
            isOneToOne: false
            referencedRelation: "notification_preferences"
            referencedColumns: ["id"]
          },
        ]
      }
      categories: {
        Row: {
          created_at: string
          id: string
          name: string
          restaurant_id: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          restaurant_id: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          restaurant_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "categories_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      custom_list_items: {
        Row: {
          category: string | null
          id: string
          item_name: string
          list_id: string
          quantity: number | null
          sort_order: number | null
          unit: string | null
        }
        Insert: {
          category?: string | null
          id?: string
          item_name: string
          list_id: string
          quantity?: number | null
          sort_order?: number | null
          unit?: string | null
        }
        Update: {
          category?: string | null
          id?: string
          item_name?: string
          list_id?: string
          quantity?: number | null
          sort_order?: number | null
          unit?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "custom_list_items_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "custom_lists"
            referencedColumns: ["id"]
          },
        ]
      }
      custom_lists: {
        Row: {
          categories: Json | null
          created_at: string
          created_by: string | null
          id: string
          name: string
          restaurant_id: string
        }
        Insert: {
          categories?: Json | null
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          restaurant_id: string
        }
        Update: {
          categories?: Json | null
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          restaurant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "custom_lists_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      delivery_issues: {
        Row: {
          catalog_item_id: string | null
          created_at: string | null
          id: string
          invoice_line_comparison_id: string | null
          issue_type: string
          item_name: string
          notes: string | null
          purchase_history_id: string
          reported_at: string | null
          resolved_at: string | null
        }
        Insert: {
          catalog_item_id?: string | null
          created_at?: string | null
          id?: string
          invoice_line_comparison_id?: string | null
          issue_type: string
          item_name: string
          notes?: string | null
          purchase_history_id: string
          reported_at?: string | null
          resolved_at?: string | null
        }
        Update: {
          catalog_item_id?: string | null
          created_at?: string | null
          id?: string
          invoice_line_comparison_id?: string | null
          issue_type?: string
          item_name?: string
          notes?: string | null
          purchase_history_id?: string
          reported_at?: string | null
          resolved_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "delivery_issues_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_catalog_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_issues_invoice_line_comparison_id_fkey"
            columns: ["invoice_line_comparison_id"]
            isOneToOne: false
            referencedRelation: "invoice_line_comparisons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_issues_purchase_history_id_fkey"
            columns: ["purchase_history_id"]
            isOneToOne: false
            referencedRelation: "purchase_history"
            referencedColumns: ["id"]
          },
        ]
      }
      import_runs: {
        Row: {
          confidence_score: number | null
          created_count: number | null
          file_name: string
          id: string
          inventory_list_id: string | null
          mapping_used_json: Json
          restaurant_id: string
          skipped_count: number | null
          template_id: string | null
          updated_count: number | null
          uploaded_at: string
          uploaded_by: string | null
          vendor_name: string | null
          warnings_json: Json | null
        }
        Insert: {
          confidence_score?: number | null
          created_count?: number | null
          file_name: string
          id?: string
          inventory_list_id?: string | null
          mapping_used_json?: Json
          restaurant_id: string
          skipped_count?: number | null
          template_id?: string | null
          updated_count?: number | null
          uploaded_at?: string
          uploaded_by?: string | null
          vendor_name?: string | null
          warnings_json?: Json | null
        }
        Update: {
          confidence_score?: number | null
          created_count?: number | null
          file_name?: string
          id?: string
          inventory_list_id?: string | null
          mapping_used_json?: Json
          restaurant_id?: string
          skipped_count?: number | null
          template_id?: string | null
          updated_count?: number | null
          uploaded_at?: string
          uploaded_by?: string | null
          vendor_name?: string | null
          warnings_json?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "import_runs_inventory_list_id_fkey"
            columns: ["inventory_list_id"]
            isOneToOne: false
            referencedRelation: "inventory_lists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_runs_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_runs_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "import_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      import_templates: {
        Row: {
          created_at: string
          file_type: string | null
          header_fingerprint: string | null
          id: string
          inventory_list_id: string | null
          last_used_at: string | null
          mapping_json: Json
          name: string
          restaurant_id: string
          updated_at: string
          vendor_name: string | null
        }
        Insert: {
          created_at?: string
          file_type?: string | null
          header_fingerprint?: string | null
          id?: string
          inventory_list_id?: string | null
          last_used_at?: string | null
          mapping_json?: Json
          name: string
          restaurant_id: string
          updated_at?: string
          vendor_name?: string | null
        }
        Update: {
          created_at?: string
          file_type?: string | null
          header_fingerprint?: string | null
          id?: string
          inventory_list_id?: string | null
          last_used_at?: string | null
          mapping_json?: Json
          name?: string
          restaurant_id?: string
          updated_at?: string
          vendor_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "import_templates_inventory_list_id_fkey"
            columns: ["inventory_list_id"]
            isOneToOne: false
            referencedRelation: "inventory_lists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_templates_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_catalog_items: {
        Row: {
          brand_name: string | null
          category: string | null
          created_at: string
          default_par_level: number | null
          default_unit_cost: number | null
          id: string
          inventory_list_id: string | null
          item_name: string
          list_category_id: string | null
          metadata: Json | null
          pack_size: string | null
          product_number: string | null
          restaurant_id: string
          sort_order: number
          unit: string | null
          updated_at: string
          vendor_name: string | null
          vendor_sku: string | null
        }
        Insert: {
          brand_name?: string | null
          category?: string | null
          created_at?: string
          default_par_level?: number | null
          default_unit_cost?: number | null
          id?: string
          inventory_list_id?: string | null
          item_name: string
          list_category_id?: string | null
          metadata?: Json | null
          pack_size?: string | null
          product_number?: string | null
          restaurant_id: string
          sort_order?: number
          unit?: string | null
          updated_at?: string
          vendor_name?: string | null
          vendor_sku?: string | null
        }
        Update: {
          brand_name?: string | null
          category?: string | null
          created_at?: string
          default_par_level?: number | null
          default_unit_cost?: number | null
          id?: string
          inventory_list_id?: string | null
          item_name?: string
          list_category_id?: string | null
          metadata?: Json | null
          pack_size?: string | null
          product_number?: string | null
          restaurant_id?: string
          sort_order?: number
          unit?: string | null
          updated_at?: string
          vendor_name?: string | null
          vendor_sku?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_catalog_items_inventory_list_id_fkey"
            columns: ["inventory_list_id"]
            isOneToOne: false
            referencedRelation: "inventory_lists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_catalog_items_list_category_id_fkey"
            columns: ["list_category_id"]
            isOneToOne: false
            referencedRelation: "list_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_catalog_items_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_import_files: {
        Row: {
          created_count: number | null
          file_name: string
          file_type: string | null
          id: string
          inventory_list_id: string
          mapping_json: Json | null
          restaurant_id: string
          row_count: number | null
          skipped_count: number | null
          uploaded_at: string
          uploaded_by: string | null
        }
        Insert: {
          created_count?: number | null
          file_name: string
          file_type?: string | null
          id?: string
          inventory_list_id: string
          mapping_json?: Json | null
          restaurant_id: string
          row_count?: number | null
          skipped_count?: number | null
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Update: {
          created_count?: number | null
          file_name?: string
          file_type?: string | null
          id?: string
          inventory_list_id?: string
          mapping_json?: Json | null
          restaurant_id?: string
          row_count?: number | null
          skipped_count?: number | null
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_import_files_inventory_list_id_fkey"
            columns: ["inventory_list_id"]
            isOneToOne: false
            referencedRelation: "inventory_lists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_import_files_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_items: {
        Row: {
          category_id: string
          created_at: string
          id: string
          item_name: string
          item_number: string | null
          pack_size: string
          restaurant_id: string
          sort_order: number
          unit_price: number
        }
        Insert: {
          category_id: string
          created_at?: string
          id?: string
          item_name: string
          item_number?: string | null
          pack_size: string
          restaurant_id: string
          sort_order?: number
          unit_price?: number
        }
        Update: {
          category_id?: string
          created_at?: string
          id?: string
          item_name?: string
          item_number?: string | null
          pack_size?: string
          restaurant_id?: string
          sort_order?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "inventory_items_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_items_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_lists: {
        Row: {
          active_category_mode: string
          created_at: string
          created_by: string | null
          id: string
          location_id: string | null
          name: string
          restaurant_id: string
        }
        Insert: {
          active_category_mode?: string
          created_at?: string
          created_by?: string | null
          id?: string
          location_id?: string | null
          name: string
          restaurant_id: string
        }
        Update: {
          active_category_mode?: string
          created_at?: string
          created_by?: string | null
          id?: string
          location_id?: string | null
          name?: string
          restaurant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_lists_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_lists_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_session_items: {
        Row: {
          brand_name: string | null
          category: string | null
          current_stock: number
          id: string
          item_name: string
          lead_time_days: number | null
          metadata: Json | null
          pack_size: string | null
          par_level: number
          session_id: string
          unit: string | null
          unit_cost: number | null
          vendor_name: string | null
          vendor_sku: string | null
        }
        Insert: {
          brand_name?: string | null
          category?: string | null
          current_stock?: number
          id?: string
          item_name: string
          lead_time_days?: number | null
          metadata?: Json | null
          pack_size?: string | null
          par_level?: number
          session_id: string
          unit?: string | null
          unit_cost?: number | null
          vendor_name?: string | null
          vendor_sku?: string | null
        }
        Update: {
          brand_name?: string | null
          category?: string | null
          current_stock?: number
          id?: string
          item_name?: string
          lead_time_days?: number | null
          metadata?: Json | null
          pack_size?: string | null
          par_level?: number
          session_id?: string
          unit?: string | null
          unit_cost?: number | null
          vendor_name?: string | null
          vendor_sku?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_session_items_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "inventory_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_sessions: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          counting_par_guide_id: string | null
          created_by: string | null
          id: string
          inventory_list_id: string
          location_id: string | null
          name: string
          restaurant_id: string
          status: Database["public"]["Enums"]["session_status"]
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          counting_par_guide_id?: string | null
          created_by?: string | null
          id?: string
          inventory_list_id: string
          location_id?: string | null
          name: string
          restaurant_id: string
          status?: Database["public"]["Enums"]["session_status"]
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          counting_par_guide_id?: string | null
          created_by?: string | null
          id?: string
          inventory_list_id?: string
          location_id?: string | null
          name?: string
          restaurant_id?: string
          status?: Database["public"]["Enums"]["session_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_sessions_counting_par_guide_id_fkey"
            columns: ["counting_par_guide_id"]
            isOneToOne: false
            referencedRelation: "par_guides"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_sessions_inventory_list_id_fkey"
            columns: ["inventory_list_id"]
            isOneToOne: false
            referencedRelation: "inventory_lists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_sessions_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_sessions_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_settings: {
        Row: {
          auto_category_enabled: boolean
          autosave_enabled: boolean
          categories: Json
          created_at: string
          default_location_id: string | null
          id: string
          restaurant_id: string
          units: Json
          updated_at: string
        }
        Insert: {
          auto_category_enabled?: boolean
          autosave_enabled?: boolean
          categories?: Json
          created_at?: string
          default_location_id?: string | null
          id?: string
          restaurant_id: string
          units?: Json
          updated_at?: string
        }
        Update: {
          auto_category_enabled?: boolean
          autosave_enabled?: boolean
          categories?: Json
          created_at?: string
          default_location_id?: string | null
          id?: string
          restaurant_id?: string
          units?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_settings_default_location_id_fkey"
            columns: ["default_location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_settings_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: true
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      invitations: {
        Row: {
          accepted_at: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string
          restaurant_id: string
          role: Database["public"]["Enums"]["app_role"]
          status: Database["public"]["Enums"]["invitation_status"]
          token: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by: string
          restaurant_id: string
          role?: Database["public"]["Enums"]["app_role"]
          status?: Database["public"]["Enums"]["invitation_status"]
          token?: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string
          restaurant_id?: string
          role?: Database["public"]["Enums"]["app_role"]
          status?: Database["public"]["Enums"]["invitation_status"]
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "invitations_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_items: {
        Row: {
          brand_name: string | null
          catalog_item_id: string | null
          created_at: string
          id: string
          invoice_id: string
          item_name: string
          match_status: string | null
          pack_size: string | null
          product_number: string | null
          quantity_invoiced: number | null
          total_cost: number | null
          unit: string | null
          unit_cost: number | null
        }
        Insert: {
          brand_name?: string | null
          catalog_item_id?: string | null
          created_at?: string
          id?: string
          invoice_id: string
          item_name: string
          match_status?: string | null
          pack_size?: string | null
          product_number?: string | null
          quantity_invoiced?: number | null
          total_cost?: number | null
          unit?: string | null
          unit_cost?: number | null
        }
        Update: {
          brand_name?: string | null
          catalog_item_id?: string | null
          created_at?: string
          id?: string
          invoice_id?: string
          item_name?: string
          match_status?: string | null
          pack_size?: string | null
          product_number?: string | null
          quantity_invoiced?: number | null
          total_cost?: number | null
          unit?: string | null
          unit_cost?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "invoice_items_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_catalog_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_line_comparisons: {
        Row: {
          catalog_item_id: string | null
          cost_diff: number | null
          created_at: string | null
          id: string
          invoiced_qty: number | null
          invoiced_unit_cost: number | null
          item_name: string
          po_qty: number | null
          po_unit_cost: number | null
          purchase_history_id: string
          purchase_history_item_id: string | null
          qty_diff: number | null
          received_qty: number | null
          smart_order_run_id: string | null
          status: string | null
        }
        Insert: {
          catalog_item_id?: string | null
          cost_diff?: number | null
          created_at?: string | null
          id?: string
          invoiced_qty?: number | null
          invoiced_unit_cost?: number | null
          item_name: string
          po_qty?: number | null
          po_unit_cost?: number | null
          purchase_history_id: string
          purchase_history_item_id?: string | null
          qty_diff?: number | null
          received_qty?: number | null
          smart_order_run_id?: string | null
          status?: string | null
        }
        Update: {
          catalog_item_id?: string | null
          cost_diff?: number | null
          created_at?: string | null
          id?: string
          invoiced_qty?: number | null
          invoiced_unit_cost?: number | null
          item_name?: string
          po_qty?: number | null
          po_unit_cost?: number | null
          purchase_history_id?: string
          purchase_history_item_id?: string | null
          qty_diff?: number | null
          received_qty?: number | null
          smart_order_run_id?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoice_line_comparisons_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_catalog_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_line_comparisons_purchase_history_id_fkey"
            columns: ["purchase_history_id"]
            isOneToOne: false
            referencedRelation: "purchase_history"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_line_comparisons_purchase_history_item_id_fkey"
            columns: ["purchase_history_item_id"]
            isOneToOne: false
            referencedRelation: "purchase_history_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_line_comparisons_smart_order_run_id_fkey"
            columns: ["smart_order_run_id"]
            isOneToOne: false
            referencedRelation: "smart_order_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          confirmed_at: string | null
          created_at: string
          created_by: string | null
          id: string
          invoice_date: string | null
          invoice_email: string | null
          invoice_number: string | null
          invoice_subtotal: number | null
          invoice_tax: number | null
          invoice_total: number | null
          location_id: string | null
          pdf_url: string | null
          purchase_order_id: string | null
          receipt_status: string | null
          restaurant_id: string
          status: string
          updated_at: string
          vendor_name: string | null
        }
        Insert: {
          confirmed_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          invoice_date?: string | null
          invoice_email?: string | null
          invoice_number?: string | null
          invoice_subtotal?: number | null
          invoice_tax?: number | null
          invoice_total?: number | null
          location_id?: string | null
          pdf_url?: string | null
          purchase_order_id?: string | null
          receipt_status?: string | null
          restaurant_id: string
          status?: string
          updated_at?: string
          vendor_name?: string | null
        }
        Update: {
          confirmed_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          invoice_date?: string | null
          invoice_email?: string | null
          invoice_number?: string | null
          invoice_subtotal?: number | null
          invoice_tax?: number | null
          invoice_total?: number | null
          location_id?: string | null
          pdf_url?: string | null
          purchase_order_id?: string | null
          receipt_status?: string | null
          restaurant_id?: string
          status?: string
          updated_at?: string
          vendor_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoices_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_purchase_order_id_fkey"
            columns: ["purchase_order_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      list_categories: {
        Row: {
          category_set_id: string | null
          created_at: string
          id: string
          list_id: string
          name: string
          sort_order: number
        }
        Insert: {
          category_set_id?: string | null
          created_at?: string
          id?: string
          list_id: string
          name: string
          sort_order?: number
        }
        Update: {
          category_set_id?: string | null
          created_at?: string
          id?: string
          list_id?: string
          name?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "list_categories_category_set_id_fkey"
            columns: ["category_set_id"]
            isOneToOne: false
            referencedRelation: "list_category_sets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "list_categories_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "inventory_lists"
            referencedColumns: ["id"]
          },
        ]
      }
      list_category_sets: {
        Row: {
          created_at: string
          id: string
          list_id: string
          set_type: string
        }
        Insert: {
          created_at?: string
          id?: string
          list_id: string
          set_type: string
        }
        Update: {
          created_at?: string
          id?: string
          list_id?: string
          set_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "list_category_sets_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "inventory_lists"
            referencedColumns: ["id"]
          },
        ]
      }
      list_item_category_map: {
        Row: {
          catalog_item_id: string
          category_id: string | null
          category_set_id: string
          id: string
          item_sort_order: number
          list_id: string
        }
        Insert: {
          catalog_item_id: string
          category_id?: string | null
          category_set_id: string
          id?: string
          item_sort_order?: number
          list_id: string
        }
        Update: {
          catalog_item_id?: string
          category_id?: string | null
          category_set_id?: string
          id?: string
          item_sort_order?: number
          list_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "list_item_category_map_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_catalog_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "list_item_category_map_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "list_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "list_item_category_map_category_set_id_fkey"
            columns: ["category_set_id"]
            isOneToOne: false
            referencedRelation: "list_category_sets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "list_item_category_map_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "inventory_lists"
            referencedColumns: ["id"]
          },
        ]
      }
      locations: {
        Row: {
          address: string | null
          city: string | null
          created_at: string
          id: string
          is_active: boolean
          is_default: boolean
          name: string
          restaurant_id: string
          state: string | null
          storage_types: Json | null
          zip: string | null
        }
        Insert: {
          address?: string | null
          city?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          is_default?: boolean
          name: string
          restaurant_id: string
          state?: string | null
          storage_types?: Json | null
          zip?: string | null
        }
        Update: {
          address?: string | null
          city?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          is_default?: boolean
          name?: string
          restaurant_id?: string
          state?: string | null
          storage_types?: Json | null
          zip?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "locations_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_preferences: {
        Row: {
          channel_email: boolean
          channel_in_app: boolean
          created_at: string
          digest_hour: number
          email_digest_mode: Database["public"]["Enums"]["email_digest_mode"]
          id: string
          location_id: string | null
          low_stock_red: boolean
          low_stock_yellow: boolean
          recipients_mode: Database["public"]["Enums"]["recipients_mode"]
          restaurant_id: string
          timezone: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          channel_email?: boolean
          channel_in_app?: boolean
          created_at?: string
          digest_hour?: number
          email_digest_mode?: Database["public"]["Enums"]["email_digest_mode"]
          id?: string
          location_id?: string | null
          low_stock_red?: boolean
          low_stock_yellow?: boolean
          recipients_mode?: Database["public"]["Enums"]["recipients_mode"]
          restaurant_id: string
          timezone?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          channel_email?: boolean
          channel_in_app?: boolean
          created_at?: string
          digest_hour?: number
          email_digest_mode?: Database["public"]["Enums"]["email_digest_mode"]
          id?: string
          location_id?: string | null
          low_stock_red?: boolean
          low_stock_yellow?: boolean
          recipients_mode?: Database["public"]["Enums"]["recipients_mode"]
          restaurant_id?: string
          timezone?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notification_preferences_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_preferences_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          created_at: string
          data: Json | null
          emailed_at: string | null
          id: string
          location_id: string | null
          message: string
          read_at: string | null
          restaurant_id: string
          severity: Database["public"]["Enums"]["notification_severity"]
          title: string
          type: string
          user_id: string
        }
        Insert: {
          created_at?: string
          data?: Json | null
          emailed_at?: string | null
          id?: string
          location_id?: string | null
          message: string
          read_at?: string | null
          restaurant_id: string
          severity?: Database["public"]["Enums"]["notification_severity"]
          title: string
          type: string
          user_id: string
        }
        Update: {
          created_at?: string
          data?: Json | null
          emailed_at?: string | null
          id?: string
          location_id?: string | null
          message?: string
          read_at?: string | null
          restaurant_id?: string
          severity?: Database["public"]["Enums"]["notification_severity"]
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          catalog_item_id: string | null
          id: string
          item_name: string
          order_id: string
          quantity: number
          unit: string | null
        }
        Insert: {
          catalog_item_id?: string | null
          id?: string
          item_name: string
          order_id: string
          quantity?: number
          unit?: string | null
        }
        Update: {
          catalog_item_id?: string | null
          id?: string
          item_name?: string
          order_id?: string
          quantity?: number
          unit?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_items_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_catalog_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          location_id: string | null
          restaurant_id: string
          status: Database["public"]["Enums"]["order_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          location_id?: string | null
          restaurant_id: string
          status?: Database["public"]["Enums"]["order_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          location_id?: string | null
          restaurant_id?: string
          status?: Database["public"]["Enums"]["order_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      par_guide_items: {
        Row: {
          brand_name: string | null
          category: string | null
          id: string
          item_name: string
          par_guide_id: string
          par_level: number
          unit: string | null
        }
        Insert: {
          brand_name?: string | null
          category?: string | null
          id?: string
          item_name: string
          par_guide_id: string
          par_level?: number
          unit?: string | null
        }
        Update: {
          brand_name?: string | null
          category?: string | null
          id?: string
          item_name?: string
          par_guide_id?: string
          par_level?: number
          unit?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "par_guide_items_par_guide_id_fkey"
            columns: ["par_guide_id"]
            isOneToOne: false
            referencedRelation: "par_guides"
            referencedColumns: ["id"]
          },
        ]
      }
      par_guides: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          inventory_list_id: string | null
          location_id: string | null
          name: string
          restaurant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          inventory_list_id?: string | null
          location_id?: string | null
          name: string
          restaurant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          inventory_list_id?: string | null
          location_id?: string | null
          name?: string
          restaurant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "par_guides_inventory_list_id_fkey"
            columns: ["inventory_list_id"]
            isOneToOne: false
            referencedRelation: "inventory_lists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "par_guides_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "par_guides_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      par_items: {
        Row: {
          category_id: string
          created_at: string
          id: string
          inventory_item_id: string
          par_level: number
          restaurant_id: string
        }
        Insert: {
          category_id: string
          created_at?: string
          id?: string
          inventory_item_id: string
          par_level?: number
          restaurant_id: string
        }
        Update: {
          category_id?: string
          created_at?: string
          id?: string
          inventory_item_id?: string
          par_level?: number
          restaurant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "par_items_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "par_items_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "par_items_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      par_settings: {
        Row: {
          auto_apply_last_par: boolean
          created_at: string
          default_lead_time_days: number
          default_reorder_threshold: number
          id: string
          restaurant_id: string
          updated_at: string
        }
        Insert: {
          auto_apply_last_par?: boolean
          created_at?: string
          default_lead_time_days?: number
          default_reorder_threshold?: number
          id?: string
          restaurant_id: string
          updated_at?: string
        }
        Update: {
          auto_apply_last_par?: boolean
          created_at?: string
          default_lead_time_days?: number
          default_reorder_threshold?: number
          id?: string
          restaurant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "par_settings_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: true
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string
          full_name: string | null
          id: string
        }
        Insert: {
          created_at?: string
          email: string
          full_name?: string | null
          id: string
        }
        Update: {
          created_at?: string
          email?: string
          full_name?: string | null
          id?: string
        }
        Relationships: []
      }
      purchase_history: {
        Row: {
          confirmed_at: string | null
          created_at: string
          created_by: string | null
          id: string
          inventory_list_id: string | null
          invoice_date: string | null
          invoice_number: string | null
          invoice_status: string
          invoice_subtotal: number | null
          invoice_tax: number | null
          invoice_total: number | null
          location_id: string | null
          pdf_url: string | null
          po_number: string | null
          purchase_order_id: string | null
          receipt_status: string | null
          restaurant_id: string
          smart_order_run_id: string | null
          source: string | null
          vendor_name: string | null
        }
        Insert: {
          confirmed_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          inventory_list_id?: string | null
          invoice_date?: string | null
          invoice_number?: string | null
          invoice_status?: string
          invoice_subtotal?: number | null
          invoice_tax?: number | null
          invoice_total?: number | null
          location_id?: string | null
          pdf_url?: string | null
          po_number?: string | null
          purchase_order_id?: string | null
          receipt_status?: string | null
          restaurant_id: string
          smart_order_run_id?: string | null
          source?: string | null
          vendor_name?: string | null
        }
        Update: {
          confirmed_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          inventory_list_id?: string | null
          invoice_date?: string | null
          invoice_number?: string | null
          invoice_status?: string
          invoice_subtotal?: number | null
          invoice_tax?: number | null
          invoice_total?: number | null
          location_id?: string | null
          pdf_url?: string | null
          po_number?: string | null
          purchase_order_id?: string | null
          receipt_status?: string | null
          restaurant_id?: string
          smart_order_run_id?: string | null
          source?: string | null
          vendor_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_history_inventory_list_id_fkey"
            columns: ["inventory_list_id"]
            isOneToOne: false
            referencedRelation: "inventory_lists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_history_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_history_purchase_order_id_fkey"
            columns: ["purchase_order_id"]
            isOneToOne: false
            referencedRelation: "smart_order_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_history_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_history_smart_order_run_id_fkey"
            columns: ["smart_order_run_id"]
            isOneToOne: false
            referencedRelation: "smart_order_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_history_items: {
        Row: {
          brand_name: string | null
          catalog_item_id: string | null
          id: string
          item_name: string
          match_status: string
          pack_size: string | null
          purchase_history_id: string
          quantity: number
          total_cost: number | null
          unit_cost: number | null
          vendor_sku: string | null
        }
        Insert: {
          brand_name?: string | null
          catalog_item_id?: string | null
          id?: string
          item_name: string
          match_status?: string
          pack_size?: string | null
          purchase_history_id: string
          quantity?: number
          total_cost?: number | null
          unit_cost?: number | null
          vendor_sku?: string | null
        }
        Update: {
          brand_name?: string | null
          catalog_item_id?: string | null
          id?: string
          item_name?: string
          match_status?: string
          pack_size?: string | null
          purchase_history_id?: string
          quantity?: number
          total_cost?: number | null
          unit_cost?: number | null
          vendor_sku?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_history_items_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_catalog_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_history_items_purchase_history_id_fkey"
            columns: ["purchase_history_id"]
            isOneToOne: false
            referencedRelation: "purchase_history"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_order_items: {
        Row: {
          brand_name: string | null
          catalog_item_id: string | null
          created_at: string
          id: string
          item_name: string
          pack_size: string | null
          product_number: string | null
          purchase_order_id: string
          quantity_ordered: number | null
          smart_order_run_item_id: string | null
          total_cost: number | null
          unit_cost: number | null
        }
        Insert: {
          brand_name?: string | null
          catalog_item_id?: string | null
          created_at?: string
          id?: string
          item_name: string
          pack_size?: string | null
          product_number?: string | null
          purchase_order_id: string
          quantity_ordered?: number | null
          smart_order_run_item_id?: string | null
          total_cost?: number | null
          unit_cost?: number | null
        }
        Update: {
          brand_name?: string | null
          catalog_item_id?: string | null
          created_at?: string
          id?: string
          item_name?: string
          pack_size?: string | null
          product_number?: string | null
          purchase_order_id?: string
          quantity_ordered?: number | null
          smart_order_run_item_id?: string | null
          total_cost?: number | null
          unit_cost?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_order_items_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_catalog_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_items_purchase_order_id_fkey"
            columns: ["purchase_order_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_items_smart_order_run_item_id_fkey"
            columns: ["smart_order_run_item_id"]
            isOneToOne: false
            referencedRelation: "smart_order_run_items"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_orders: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          notes: string | null
          po_number: string | null
          restaurant_id: string
          smart_order_run_id: string | null
          status: string
          submitted_at: string | null
          updated_at: string
          vendor_name: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          po_number?: string | null
          restaurant_id: string
          smart_order_run_id?: string | null
          status?: string
          submitted_at?: string | null
          updated_at?: string
          vendor_name?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          po_number?: string | null
          restaurant_id?: string
          smart_order_run_id?: string | null
          status?: string
          submitted_at?: string | null
          updated_at?: string
          vendor_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_orders_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_smart_order_run_id_fkey"
            columns: ["smart_order_run_id"]
            isOneToOne: false
            referencedRelation: "smart_order_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      reminder_targets: {
        Row: {
          id: string
          reminder_id: string
          user_id: string
        }
        Insert: {
          id?: string
          reminder_id: string
          user_id: string
        }
        Update: {
          id?: string
          reminder_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reminder_targets_reminder_id_fkey"
            columns: ["reminder_id"]
            isOneToOne: false
            referencedRelation: "reminders"
            referencedColumns: ["id"]
          },
        ]
      }
      reminders: {
        Row: {
          auto_create_session: boolean
          created_at: string
          created_by: string | null
          days_of_week: Json
          id: string
          inventory_list_id: string | null
          is_enabled: boolean
          location_id: string | null
          lock_after_hours: number | null
          name: string
          recipients_mode: Database["public"]["Enums"]["recipients_mode"]
          reminder_lead_minutes: number
          restaurant_id: string
          time_of_day: string
          timezone: string
          updated_at: string
        }
        Insert: {
          auto_create_session?: boolean
          created_at?: string
          created_by?: string | null
          days_of_week?: Json
          id?: string
          inventory_list_id?: string | null
          is_enabled?: boolean
          location_id?: string | null
          lock_after_hours?: number | null
          name: string
          recipients_mode?: Database["public"]["Enums"]["recipients_mode"]
          reminder_lead_minutes?: number
          restaurant_id: string
          time_of_day?: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          auto_create_session?: boolean
          created_at?: string
          created_by?: string | null
          days_of_week?: Json
          id?: string
          inventory_list_id?: string | null
          is_enabled?: boolean
          location_id?: string | null
          lock_after_hours?: number | null
          name?: string
          recipients_mode?: Database["public"]["Enums"]["recipients_mode"]
          reminder_lead_minutes?: number
          restaurant_id?: string
          time_of_day?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reminders_inventory_list_id_fkey"
            columns: ["inventory_list_id"]
            isOneToOne: false
            referencedRelation: "inventory_lists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reminders_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reminders_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      restaurant_counters: {
        Row: {
          po_sequence: number
          restaurant_id: string
        }
        Insert: {
          po_sequence?: number
          restaurant_id: string
        }
        Update: {
          po_sequence?: number
          restaurant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "restaurant_counters_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: true
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      restaurant_members: {
        Row: {
          created_at: string
          default_location_id: string | null
          id: string
          restaurant_id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          default_location_id?: string | null
          id?: string
          restaurant_id: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          default_location_id?: string | null
          id?: string
          restaurant_id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "restaurant_members_default_location_id_fkey"
            columns: ["default_location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "restaurant_members_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      restaurant_settings: {
        Row: {
          address: string | null
          business_email: string | null
          created_at: string
          currency: string
          date_format: string
          id: string
          invoice_email: string | null
          logo_url: string | null
          phone: string | null
          restaurant_id: string
          timezone: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          business_email?: string | null
          created_at?: string
          currency?: string
          date_format?: string
          id?: string
          invoice_email?: string | null
          logo_url?: string | null
          phone?: string | null
          restaurant_id: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          business_email?: string | null
          created_at?: string
          currency?: string
          date_format?: string
          id?: string
          invoice_email?: string | null
          logo_url?: string | null
          phone?: string | null
          restaurant_id?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "restaurant_settings_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: true
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      restaurants: {
        Row: {
          created_at: string
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      smart_order_run_items: {
        Row: {
          brand_name: string | null
          catalog_item_id: string | null
          current_stock: number
          id: string
          item_name: string
          pack_size: string | null
          par_level: number
          risk: string
          run_id: string
          suggested_order: number
          unit_cost: number | null
        }
        Insert: {
          brand_name?: string | null
          catalog_item_id?: string | null
          current_stock?: number
          id?: string
          item_name: string
          pack_size?: string | null
          par_level?: number
          risk?: string
          run_id: string
          suggested_order?: number
          unit_cost?: number | null
        }
        Update: {
          brand_name?: string | null
          catalog_item_id?: string | null
          current_stock?: number
          id?: string
          item_name?: string
          pack_size?: string | null
          par_level?: number
          risk?: string
          run_id?: string
          suggested_order?: number
          unit_cost?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "smart_order_run_items_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_catalog_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "smart_order_run_items_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "smart_order_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      smart_order_runs: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          inventory_list_id: string | null
          location_id: string | null
          par_guide_id: string | null
          po_number: string | null
          restaurant_id: string
          session_id: string
          status: string
          submitted_at: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          inventory_list_id?: string | null
          location_id?: string | null
          par_guide_id?: string | null
          po_number?: string | null
          restaurant_id: string
          session_id: string
          status?: string
          submitted_at?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          inventory_list_id?: string | null
          location_id?: string | null
          par_guide_id?: string | null
          po_number?: string | null
          restaurant_id?: string
          session_id?: string
          status?: string
          submitted_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "smart_order_runs_inventory_list_id_fkey"
            columns: ["inventory_list_id"]
            isOneToOne: false
            referencedRelation: "inventory_lists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "smart_order_runs_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "smart_order_runs_par_guide_id_fkey"
            columns: ["par_guide_id"]
            isOneToOne: false
            referencedRelation: "par_guides"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "smart_order_runs_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "smart_order_runs_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "inventory_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      smart_order_settings: {
        Row: {
          auto_calculate_cost: boolean
          auto_create_purchase_history: boolean
          created_at: string
          id: string
          red_threshold: number
          restaurant_id: string
          updated_at: string
          yellow_threshold: number
        }
        Insert: {
          auto_calculate_cost?: boolean
          auto_create_purchase_history?: boolean
          created_at?: string
          id?: string
          red_threshold?: number
          restaurant_id: string
          updated_at?: string
          yellow_threshold?: number
        }
        Update: {
          auto_calculate_cost?: boolean
          auto_create_purchase_history?: boolean
          created_at?: string
          id?: string
          red_threshold?: number
          restaurant_id?: string
          updated_at?: string
          yellow_threshold?: number
        }
        Relationships: [
          {
            foreignKeyName: "smart_order_settings_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: true
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      usage_events: {
        Row: {
          created_at: string
          id: string
          item_name: string
          order_id: string | null
          quantity_used: number
          restaurant_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          item_name: string
          order_id?: string | null
          quantity_used?: number
          restaurant_id: string
        }
        Update: {
          created_at?: string
          id?: string
          item_name?: string
          order_id?: string | null
          quantity_used?: number
          restaurant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "usage_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "usage_events_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      user_ui_state: {
        Row: {
          id: string
          selected_location_id: string | null
          selected_restaurant_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          id?: string
          selected_location_id?: string | null
          selected_restaurant_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          id?: string
          selected_location_id?: string | null
          selected_restaurant_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_ui_state_selected_location_id_fkey"
            columns: ["selected_location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_ui_state_selected_restaurant_id_fkey"
            columns: ["selected_restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      vendor_integrations: {
        Row: {
          account_id: string | null
          api_key_encrypted: string | null
          created_at: string
          customer_number: string | null
          id: string
          is_enabled: boolean
          location_id: string | null
          restaurant_id: string
          updated_at: string
          vendor_name: string
        }
        Insert: {
          account_id?: string | null
          api_key_encrypted?: string | null
          created_at?: string
          customer_number?: string | null
          id?: string
          is_enabled?: boolean
          location_id?: string | null
          restaurant_id: string
          updated_at?: string
          vendor_name: string
        }
        Update: {
          account_id?: string | null
          api_key_encrypted?: string | null
          created_at?: string
          customer_number?: string | null
          id?: string
          is_enabled?: boolean
          location_id?: string | null
          restaurant_id?: string
          updated_at?: string
          vendor_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "vendor_integrations_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_integrations_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      vendor_item_mappings: {
        Row: {
          catalog_item_id: string
          created_at: string
          id: string
          restaurant_id: string
          updated_at: string
          vendor_item_name: string
          vendor_name: string
          vendor_sku: string | null
        }
        Insert: {
          catalog_item_id: string
          created_at?: string
          id?: string
          restaurant_id: string
          updated_at?: string
          vendor_item_name: string
          vendor_name: string
          vendor_sku?: string | null
        }
        Update: {
          catalog_item_id?: string
          created_at?: string
          id?: string
          restaurant_id?: string
          updated_at?: string
          vendor_item_name?: string
          vendor_name?: string
          vendor_sku?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vendor_item_mappings_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_catalog_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_item_mappings_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      waste_log: {
        Row: {
          created_at: string
          id: string
          item_name: string
          logged_at: string
          logged_by: string
          notes: string | null
          quantity: number
          reason: string
          restaurant_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          item_name: string
          logged_at?: string
          logged_by: string
          notes?: string | null
          quantity: number
          reason: string
          restaurant_id: string
        }
        Update: {
          created_at?: string
          id?: string
          item_name?: string
          logged_at?: string
          logged_by?: string
          notes?: string | null
          quantity?: number
          reason?: string
          restaurant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "waste_log_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      alert_pref_restaurant_id: { Args: { pref_id: string }; Returns: string }
      confirm_invoice_receipt: {
        Args: { p_invoice_id: string; p_restaurant_id: string }
        Returns: Json
      }
      create_restaurant_with_owner: {
        Args: { p_is_demo?: boolean; p_name: string }
        Returns: {
          created_at: string
          id: string
          name: string
        }
        SetofOptions: {
          from: "*"
          to: "restaurants"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      custom_list_restaurant_id: { Args: { cl_id: string }; Returns: string }
      delete_restaurant_cascade: {
        Args: { p_restaurant_id: string }
        Returns: undefined
      }
      generate_po_number: { Args: { p_restaurant_id: string }; Returns: string }
      get_delivery_issue_pos: {
        Args: { p_restaurant_id: string }
        Returns: {
          issue_count: number
          po_number: string
          purchase_history_id: string
        }[]
      }
      has_restaurant_role: {
        Args: { _role: Database["public"]["Enums"]["app_role"]; r_id: string }
        Returns: boolean
      }
      has_restaurant_role_any: {
        Args: {
          _roles: Database["public"]["Enums"]["app_role"][]
          r_id: string
        }
        Returns: boolean
      }
      invitation_restaurant_id: { Args: { inv_id: string }; Returns: string }
      is_member_of: { Args: { r_id: string }; Returns: boolean }
      list_category_restaurant_id: {
        Args: { lc_list_id: string }
        Returns: string
      }
      list_item_map_restaurant_id: {
        Args: { p_list_id: string }
        Returns: string
      }
      notify_delivery_issues: {
        Args: { p_purchase_history_id: string }
        Returns: Json
      }
      order_restaurant_id: { Args: { o_id: string }; Returns: string }
      par_guide_restaurant_id: { Args: { pg_id: string }; Returns: string }
      purchase_history_restaurant_id: {
        Args: { ph_id: string }
        Returns: string
      }
      reminder_restaurant_id: { Args: { r_id: string }; Returns: string }
      session_restaurant_id: { Args: { s_id: string }; Returns: string }
      smart_order_run_restaurant_id: {
        Args: { sr_id: string }
        Returns: string
      }
      submit_smart_order: { Args: { p_run_id: string }; Returns: Json }
    }
    Enums: {
      app_role: "OWNER" | "MANAGER" | "STAFF"
      email_digest_mode: "IMMEDIATE" | "DAILY_DIGEST"
      invitation_status: "PENDING" | "ACCEPTED" | "EXPIRED" | "REVOKED"
      notification_severity: "INFO" | "WARNING" | "CRITICAL"
      order_status: "PENDING" | "PREP" | "READY" | "COMPLETED" | "CANCELED"
      recipients_mode: "OWNERS_MANAGERS" | "ALL" | "CUSTOM"
      session_status: "IN_PROGRESS" | "IN_REVIEW" | "APPROVED"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["OWNER", "MANAGER", "STAFF"],
      email_digest_mode: ["IMMEDIATE", "DAILY_DIGEST"],
      invitation_status: ["PENDING", "ACCEPTED", "EXPIRED", "REVOKED"],
      notification_severity: ["INFO", "WARNING", "CRITICAL"],
      order_status: ["PENDING", "PREP", "READY", "COMPLETED", "CANCELED"],
      recipients_mode: ["OWNERS_MANAGERS", "ALL", "CUSTOM"],
      session_status: ["IN_PROGRESS", "IN_REVIEW", "APPROVED"],
    },
  },
} as const
