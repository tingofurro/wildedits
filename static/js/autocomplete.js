// Autocomplete state variables
var autocomplete_text = "";
var autocomplete_timer = null;
var autocomplete_active = false;
var autocomplete_cursor_position = -1;
var autocomplete_in_progress = false;
var autocomplete_last_cursor_line = -1;
var autocomplete_last_cursor_pos = -1;
var autocomplete_disabled = false;

function check_autocomplete_trigger() {
    // Don't trigger if autocomplete is disabled
    if (autocomplete_disabled) {
        return;
    }
    
    // Clear any existing timer
    if (autocomplete_timer) {
        clearTimeout(autocomplete_timer);
        autocomplete_timer = null;
    }
    
    // Dismiss any existing autocomplete
    dismiss_autocomplete();
    
    // Check if cursor is at end of line
    if (!is_cursor_at_line_end()) {
        return;
    }
    
    // Set a new timer for 500ms
    autocomplete_timer = setTimeout(function() {
        request_autocomplete();
    }, 500);
}

function is_cursor_at_line_end() {
    save_cursor();
    
    if (!cursor_index || cursor_index.line_index === undefined) {
        return false;
    }
    
    var current_text_local = get_current_text();
    var lines = current_text_local.split("\n");
    
    if (cursor_index.line_index >= lines.length) {
        return false;
    }
    
    var current_line = lines[cursor_index.line_index];
    var cursor_pos_in_line = cursor_index.position;
    
    // Check if cursor is at the end of the line (allowing for trailing spaces)
    return cursor_pos_in_line >= current_line.trimEnd().length;
}

function get_cursor_position_in_document() {
    save_cursor();
    
    if (!cursor_index || cursor_index.line_index === undefined) {
        return -1;
    }
    
    var current_text_local = get_current_text();
    var lines = current_text_local.split("\n");
    var position = 0;
    
    // Add length of all previous lines (including newlines)
    for (var i = 0; i < cursor_index.line_index; i++) {
        position += lines[i].length + 1; // +1 for the newline character
    }
    
    // Add position within current line
    position += cursor_index.position;
    
    return position;
}

function request_autocomplete() {
    if (autocomplete_in_progress) {
        return;
    }
    
    var cursor_pos = get_cursor_position_in_document();
    if (cursor_pos < 0) {
        return;
    }
    
    autocomplete_cursor_position = cursor_pos;
    autocomplete_in_progress = true;
    
    var post_obj = {"doc_id": active_doc_id, "cursor_position": cursor_pos};
    
    $.post(api_server + "get_autocomplete", post_obj, function(data) {
        autocomplete_in_progress = false;
        
        if (data.success && data.completion && data.completion.length > 0) {
            // Check if cursor is still at the same position
            var current_pos = get_cursor_position_in_document();
            if (current_pos === autocomplete_cursor_position && is_cursor_at_line_end()) {
                display_autocomplete(data.completion);
            }
        }
    }, "json").fail(function() {
        autocomplete_in_progress = false;
        console.log("Failed to get autocomplete");
    });
}

function display_autocomplete(text) {
    // First dismiss any existing autocomplete
    dismiss_autocomplete();
    
    // Set state BEFORE saving cursor to avoid race conditions
    autocomplete_text = text;
    
    // Get the selection and range
    var selection = window.getSelection();
    if (selection.rangeCount === 0) {
        return;
    }
    
    var range = selection.getRangeAt(0);
    
    // Create a span element for the ghost text
    var ghost_span = document.createElement('span');
    ghost_span.id = 'autocomplete_ghost';
    ghost_span.className = 'autocomplete_ghost';
    ghost_span.contentEditable = 'false';
    ghost_span.textContent = text;
    
    // Insert the ghost text at the cursor position
    range.insertNode(ghost_span);
    
    // Move cursor back to the original position (before the ghost text)
    range.setStartBefore(ghost_span);
    range.setEndBefore(ghost_span);
    selection.removeAllRanges();
    selection.addRange(range);
    
    // NOW save cursor position and set active flag AFTER ghost is inserted
    // This prevents check_cursor_moved_and_dismiss from firing during save_cursor
    if (cursor_index) {
        autocomplete_last_cursor_line = cursor_index.line_index;
        autocomplete_last_cursor_pos = cursor_index.position;
    }
    autocomplete_active = true;
}

function accept_autocomplete() {
    if (!autocomplete_active || !autocomplete_text) {
        return;
    }
    
    // Remove the ghost text element
    var ghost_elem = document.getElementById('autocomplete_ghost');
    if (ghost_elem) {
        ghost_elem.remove();
    }
    
    // Insert the actual text at cursor position
    var selection = window.getSelection();
    if (selection.rangeCount > 0) {
        var range = selection.getRangeAt(0);
        range.deleteContents();
        
        var text_node = document.createTextNode(autocomplete_text);
        range.insertNode(text_node);
        
        // Move cursor to end of inserted text
        range.setStartAfter(text_node);
        range.setEndAfter(text_node);
        selection.removeAllRanges();
        selection.addRange(range);
    }
    
    // Save the document state
    var accepted_text = autocomplete_text;
    autocomplete_text = "";
    autocomplete_active = false;
    autocomplete_cursor_position = -1;
    
    // Save document with metadata about autocomplete acceptance
    save_document_state([], [], function() {
        reload_view();
    });
}

function dismiss_autocomplete() {
    // Always try to remove the ghost element if it exists, regardless of flag state
    var ghost_elem = document.getElementById('autocomplete_ghost');
    if (ghost_elem) {
        ghost_elem.remove();
    }
    
    // Clear state regardless
    autocomplete_text = "";
    autocomplete_active = false;
    autocomplete_cursor_position = -1;
    autocomplete_last_cursor_line = -1;
    autocomplete_last_cursor_pos = -1;
}

function check_cursor_moved_and_dismiss() {
    // Check if ghost element actually exists first
    var ghost_elem = document.getElementById('autocomplete_ghost');
    if (!ghost_elem) {
        return;
    }
    
    // Check if cursor has moved from where autocomplete was displayed
    // Note: cursor_index is already updated by save_cursor() before this is called
    if (cursor_index && autocomplete_last_cursor_line >= 0) {
        if (cursor_index.line_index !== autocomplete_last_cursor_line || 
            cursor_index.position !== autocomplete_last_cursor_pos) {
            dismiss_autocomplete();
        }
    }
}

function handle_autocomplete_tab() {
    var ghost_elem = document.getElementById('autocomplete_ghost');
    if (!ghost_elem) {
        return false;
    }
    
    // Capture the text from the ghost element directly
    var completion_text = ghost_elem.textContent;
    
    // Store the old cursor position before we modify anything
    var old_cursor_line = typeof autocomplete_last_cursor_line !== 'undefined' ? autocomplete_last_cursor_line : (cursor_index ? cursor_index.line_index : 0);
    var old_cursor_pos = typeof autocomplete_last_cursor_pos !== 'undefined' ? autocomplete_last_cursor_pos : (cursor_index ? cursor_index.position : 0);
    
    // Get current selection before removing ghost
    var selection = window.getSelection();
    var range = selection.getRangeAt(0);
    
    // Remove ghost element first
    ghost_elem.remove();
    
    // Insert the completion text at the cursor position
    var text_node = document.createTextNode(completion_text);
    range.insertNode(text_node);
    
    // Move cursor to END of inserted text
    var new_range = document.createRange();
    new_range.setStartAfter(text_node);
    new_range.setEndAfter(text_node);
    new_range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(new_range);
    
    // Manually update cursor_index to new position
    var newline_count = (completion_text.match(/\n/g) || []).length;
    if (newline_count > 0) {
        var lines = completion_text.split('\n');
        cursor_index = {
            line_index: old_cursor_line + newline_count,
            position: lines[lines.length - 1].length
        };
    } else {
        cursor_index = {
            line_index: old_cursor_line,
            position: old_cursor_pos + completion_text.length
        };
    }
    
    // Clear autocomplete state
    autocomplete_active = false;
    autocomplete_text = "";
    autocomplete_cursor_position = -1;
    autocomplete_last_cursor_line = -1;
    autocomplete_last_cursor_pos = -1;
    
    // Save state
    setTimeout(function() {
        save_document_state([], [], function() {
            reload_view();
        });
    }, 10);
    
    return true;
}

function handle_autocomplete_escape() {
    var ghost_elem = document.getElementById('autocomplete_ghost');
    if (!ghost_elem) {
        return false;
    }
    
    // Get the position where autocomplete was displayed
    var restore_line = typeof autocomplete_last_cursor_line !== 'undefined' ? autocomplete_last_cursor_line : (cursor_index ? cursor_index.line_index : 0);
    var restore_pos = typeof autocomplete_last_cursor_pos !== 'undefined' ? autocomplete_last_cursor_pos : (cursor_index ? cursor_index.position : 0);
    
    // Remove ghost element first
    ghost_elem.remove();
    
    // Clear state
    autocomplete_active = false;
    autocomplete_text = "";
    autocomplete_cursor_position = -1;
    autocomplete_last_cursor_line = -1;
    autocomplete_last_cursor_pos = -1;
    
    // Save the current document state first to capture any typed text
    // Then reload view with cursor at original position
    setTimeout(function() {
        save_document_state([], [], function() {
            cursor_index = {
                line_index: restore_line,
                position: restore_pos
            };
            reload_view();
        });
    }, 10);
    
    return true;
}

function toggle_autocomplete() {
    autocomplete_disabled = !autocomplete_disabled;
    $(".checkbox_autocomplete input[type='checkbox']").prop("checked", !autocomplete_disabled);
    
    // If disabling, dismiss any active autocomplete
    if (autocomplete_disabled) {
        dismiss_autocomplete();
    }
    
    // Save to server
    var post_obj = {"doc_id": active_doc_id, "autocomplete_disabled": autocomplete_disabled ? "1" : "0"};
    $.post(api_server + "change_autocomplete_disabled", post_obj, function(data) {
        console.log("Autocomplete " + (autocomplete_disabled ? "disabled" : "enabled"));
    }, "json");
}

function change_autocomplete_to(disabled, skip_api_save) {
    autocomplete_disabled = disabled;
    $(".checkbox_autocomplete input[type='checkbox']").prop("checked", !disabled);
    
    if (disabled) {
        dismiss_autocomplete();
    }
    
    if (!skip_api_save) {
        var post_obj = {"doc_id": active_doc_id, "autocomplete_disabled": disabled ? "1" : "0"};
        $.post(api_server + "change_autocomplete_disabled", post_obj, function(data) {}, "json");
    }
}

