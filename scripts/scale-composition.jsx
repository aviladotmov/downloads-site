/*
  Scale Composition (layer-style aware)
  v1.0.1 · build 010 · 2026-11-21

  Based on the native After Effects script "Scale Composition.jsx" (Adobe).
  Layer Styles adjustment by André Ávila · avila.mov

  Scales the active comp and every layer in it (cameras included) and,
  optionally, adjusts layer styles, which do NOT follow the layer's scale:
    Stroke (Size), Drop/Inner Shadow (Distance, Size), Outer/Inner Glow (Size),
    Bevel and Emboss (Size, Soften), Satin (Distance, Size),
    Pattern Overlay (Scale, Offset).

  CHANGELOG
  v1.0.1 · b010 · 2026-11-21 — confirmation message in the status line after scaling.
  v1.0.0 · b009 · 2026-11-21 — public release.
  v0.1.7 · b008 · 2026-11-21 — UI and code in English; version removed from the window title and footer.
  v0.1.6 · b007 · 2026-11-21 — text-only credit in the footer (no link); authorship in the code.
  v0.1.5 · b006 · 2026-11-21 — avila.mov signature in the footer (clickable).
  v0.1.4 · b005 · 2026-11-21 — removed opacity compensation; out-of-range values stay at the limit.
  v0.1.3 · b004 · 2026-11-21 — out-of-range values are clamped instead of skipped; strokes below 1 px compensated via opacity.
  v0.1.2 · b003 · 2026-11-21 — fixed layer styles being skipped on text and shape layers.
  v0.1.1 · b002 · 2026-11-21 — fixed layer styles not being adjusted; removed the text stroke option.
  v0.1.0 · b001 · 2026-11-21 — first version with stroke/layer style adjustment.
*/
{
	var SCRIPT_VERSION = '1.0.1';
	var SCRIPT_BUILD = 10;

	function ScaleComposition(thisObj)
	{
		var scriptName = "Scale Composition";

		var scale_factor = 1.0;
		var ui = null;

		// Layer style properties measured in pixels.
		// Spread/Choke, Depth, Opacity etc. are percentages and are left alone.
		var STYLE_PIXEL_PROPS = {
			"frameFX/size": true,
			"dropShadow/distance": true,
			"dropShadow/blur": true,
			"innerShadow/distance": true,
			"innerShadow/blur": true,
			"outerGlow/blur": true,
			"innerGlow/blur": true,
			"bevelEmboss/blur": true,
			"bevelEmboss/softness": true,
			"chromeFX/distance": true,
			"chromeFX/blur": true,
			"patternFill/scale": true,
			"patternFill/phase": true
		};

		function getActiveComp()
		{
			var item = app.project.activeItem;
			if ((item == null) || !(item instanceof CompItem)) {
				alert("Please select or open a composition first.", scriptName);
				return null;
			}
			return item;
		}

		// ------------------------------------------------------------------
		// UI callbacks
		// ------------------------------------------------------------------
		function refreshTextField()
		{
			var opts = ui.optsRow;
			if (opts.scaleButton.value) {
				opts.text_input.text = scale_factor;
			} else {
				var comp = getActiveComp();
				if (!comp) return;
				opts.text_input.text = opts.widthButton.value
					? Math.floor(comp.width * scale_factor)
					: Math.floor(comp.height * scale_factor);
			}
		}

		function testNewScale(test_scale, comp)
		{
			var w = test_scale * comp.width, h = test_scale * comp.height;
			return !(w < 1 || w > 30000 || h < 1 || h > 30000);
		}

		function on_textInput_changed()
		{
			var comp = getActiveComp();
			if (!comp) return;
			var opts = ui.optsRow;
			var value = parseFloat(opts.text_input.text);
			if (isNaN(value) || value <= 0) {
				alert(opts.text_input.text + " is not a valid number.", scriptName);
				refreshTextField();
				return;
			}
			var new_scale_factor;
			if (opts.scaleButton.value)      new_scale_factor = value;
			else if (opts.widthButton.value) new_scale_factor = value / comp.width;
			else                             new_scale_factor = value / comp.height;

			if (testNewScale(new_scale_factor, comp)) {
				scale_factor = new_scale_factor;
			} else {
				alert("Value will make height or width out of range 1 to 30000. Reverting to previous value.", scriptName);
				refreshTextField();
			}
		}

		function onScaleClick()
		{
			var comp = getActiveComp();
			if (!comp) return;

			// Validate the input field, in case the user didn't defocus it first.
			on_textInput_changed();
			if (scale_factor == 1) return;

			var doStyles = ui.extraRow.stylesCheck.value;
			var report = { styles: 0, clamped: 0, skippedExpr: 0, firstError: null };

			app.beginUndoGroup(scriptName);

			var null3DLayer = comp.layers.addNull();
			var nullSource = null3DLayer.source;
			null3DLayer.threeDLayer = true;
			null3DLayer.position.setValue([0, 0, 0]);

			makeParentLayerOfAllUnparented(comp, null3DLayer);

			comp.width  = Math.floor(comp.width  * scale_factor);
			comp.height = Math.floor(comp.height * scale_factor);

			scaleAllCameraZooms(comp, scale_factor);

			var s = null3DLayer.scale.value;
			null3DLayer.scale.setValue([s[0] * scale_factor, s[1] * scale_factor, s[2] * scale_factor]);

			null3DLayer.remove();

			// Remove the null's solid, which would otherwise be left in the Solids folder.
			try { if (nullSource && nullSource.usedIn.length == 0) nullSource.remove(); } catch (e) {}

			if (doStyles) scaleAllLayerStyles(comp, scale_factor, report);

			app.endUndoGroup();

			// Confirmation in the status line (non-blocking, no popup).
			var msg = "Composition scaled to " + comp.width + "\u00D7" + comp.height;
			if (doStyles) {
				msg += "\n" + report.styles + " layer style value" + (report.styles == 1 ? "" : "s") + " adjusted";
				if (report.clamped > 0) msg += " \u00B7 " + report.clamped + " at AE limit";
				if (report.skippedExpr > 0) msg += " \u00B7 " + report.skippedExpr + " with expressions (skipped)";
			}
			if (report.firstError) msg += "\nError: " + report.firstError;
			ui.statusStr.text = msg;

			scale_factor = 1.0;
			if (ui.optsRow.scaleButton.value) ui.optsRow.text_input.text = "1.0";
		}

		// ------------------------------------------------------------------
		// Layer styles
		// Adjustment by André Ávila (avila.mov), 2026.
		// Layer styles don't follow the layer's scale, so their pixel values
		// are multiplied by the scale factor. If the result goes past the
		// minimum/maximum accepted by AE, the value stays at the limit.
		// ------------------------------------------------------------------
		function multiplyValue(v, f)
		{
			if (v instanceof Array) {
				var out = [];
				for (var i = 0; i < v.length; i++) out.push(v[i] * f);
				return out;
			}
			return v * f;
		}

		// Clamps the value to the property's accepted range. Without this, AE
		// rejects setValue and the value is left unadjusted (e.g. Stroke Size min is 1).
		function clampToRange(prop, v, info)
		{
			if (v instanceof Array) return v;
			var c = v;
			if (prop.hasMin && c < prop.minValue) c = prop.minValue;
			if (prop.hasMax && c > prop.maxValue) c = prop.maxValue;
			if (c != v) info.clamped = true;
			return c;
		}

		// Returns null if skipped; otherwise { clamped }.
		function scaleProperty(prop, f, report)
		{
			if (prop.canSetExpression && prop.expressionEnabled && prop.expression != "") {
				report.skippedExpr++;
				return null;
			}
			var info = { clamped: false };
			if (prop.numKeys == 0) {
				prop.setValue(clampToRange(prop, multiplyValue(prop.value, f), info));
			} else {
				for (var k = 1; k <= prop.numKeys; k++) {
					prop.setValueAtKey(k, clampToRange(prop, multiplyValue(prop.keyValue(k), f), info));
				}
			}
			if (info.clamped) report.clamped++;
			return info;
		}

		// Every layer carries all style groups, even the ones not applied
		// (they are hidden). AE rejects setValue on hidden properties, so each
		// attempt goes in a try: applied styles change, hidden ones are ignored.
		function scaleLayerStyles(layer, f, report)
		{
			var styles = layer.property("ADBE Layer Styles");
			if (!styles) return;
			for (var i = 1; i <= styles.numProperties; i++) {
				var group = styles.property(i);
				if (group.propertyType == PropertyType.PROPERTY) continue;
				for (var j = 1; j <= group.numProperties; j++) {
					var p = group.property(j);
					if (p.propertyType != PropertyType.PROPERTY || !STYLE_PIXEL_PROPS[p.matchName]) continue;
					try {
						var info = scaleProperty(p, f, report);
						if (!info) continue;
						report.styles++;
					} catch (e) {}
				}
			}
		}

		function scaleAllLayerStyles(comp, f, report)
		{
			for (var i = 1; i <= comp.numLayers; i++) {
				var layer = comp.layer(i);
				// Don't use "instanceof AVLayer": in ExtendScript it returns false
				// for TextLayer and ShapeLayer. Only cameras and lights have no styles.
				if (layer instanceof CameraLayer || layer instanceof LightLayer) continue;
				var wasLocked = layer.locked;
				layer.locked = false;
				try { scaleLayerStyles(layer, f, report); }
				catch (e) { if (!report.firstError) report.firstError = layer.name + ": " + e.toString(); }
				layer.locked = wasLocked;
			}
		}

		// ------------------------------------------------------------------
		// Original functions
		// ------------------------------------------------------------------
		function makeParentLayerOfAllUnparented(theComp, newParent)
		{
			for (var i = 1; i <= theComp.numLayers; i++) {
				var curLayer = theComp.layer(i);
				var wasLocked = curLayer.locked;
				curLayer.locked = false;
				if (curLayer != newParent && curLayer.parent == null) {
					curLayer.parent = newParent;
				}
				curLayer.locked = wasLocked;
			}
		}

		function scaleAllCameraZooms(theComp, scaleBy)
		{
			for (var i = 1; i <= theComp.numLayers; i++) {
				var curLayer = theComp.layer(i);
				if (curLayer.matchName == "ADBE Camera Layer") {
					var curZoom = curLayer.zoom;
					if (curZoom.numKeys == 0) {
						curZoom.setValue(curZoom.value * scaleBy);
					} else {
						for (var j = 1; j <= curZoom.numKeys; j++) {
							curZoom.setValueAtKey(j, curZoom.keyValue(j) * scaleBy);
						}
					}
				}
			}
		}

		// ------------------------------------------------------------------
		// UI
		// ------------------------------------------------------------------
		function BuildAndShowUI(thisObj)
		{
			var pal = (thisObj instanceof Panel) ? thisObj : new Window("palette", scriptName, undefined, {resizeable: true});
			if (pal == null) return null;

			var res =
				"group { \
					orientation:'column', alignment:['fill','top'], alignChildren:['left','top'], spacing:5, margins:[0,0,0,0], \
					introStr: StaticText { text:'Scale composition using:', alignment:['left','center'] }, \
					optsRow: Group { \
						orientation:'column', alignment:['fill','top'], \
						scaleButton: RadioButton { text:'New Scale Factor', alignment:['fill','top'], value:'true' }, \
						widthButton: RadioButton { text:'New Comp Width', alignment:['fill','top'] }, \
						heightButton: RadioButton { text:'New Comp Height', alignment:['fill','top'] }, \
						text_input: EditText { text:'1.0', alignment:['left','top'], preferredSize:[80,20] }, \
					}, \
					extraRow: Group { \
						orientation:'column', alignment:['fill','top'], alignChildren:['left','top'], \
						stylesCheck: Checkbox { text:'Adjust Layer Styles (stroke, shadow, glow...)', value:true }, \
					}, \
					cmds: Group { \
						alignment:['fill','top'], \
						okButton: Button { text:'Scale', alignment:['fill','center'] }, \
					}, \
					statusStr: StaticText { text:'', alignment:['fill','top'], preferredSize:[-1,32], properties:{multiline:true} }, \
					footer: Group { \
						orientation:'column', alignment:['fill','bottom'], alignChildren:['left','top'], \
						creditStr: StaticText { text:'Based on the Adobe script · adjusted by André Ávila', alignment:['left','top'] }, \
					}, \
				}";

			pal.margins = [10, 10, 10, 10];
			ui = pal.grp = pal.add(res);
			ui.footer.creditStr.enabled = false;

			ui.optsRow.scaleButton.onClick  = refreshTextField;
			ui.optsRow.widthButton.onClick  = refreshTextField;
			ui.optsRow.heightButton.onClick = refreshTextField;
			ui.optsRow.text_input.onChange  = on_textInput_changed;
			ui.cmds.okButton.onClick        = onScaleClick;

			pal.onResizing = pal.onResize = function () { this.layout.resize(); };
			return pal;
		}

		if (parseFloat(app.version) < 8) {
			alert("This script requires After Effects CS3 or later.", scriptName);
			return;
		}

		var pal = BuildAndShowUI(thisObj);
		if (pal != null) {
			if (pal instanceof Window) {
				pal.center();
				pal.show();
			} else {
				pal.layout.layout(true);
				pal.layout.resize();
			}
		} else {
			alert("Could not open the user interface.", scriptName);
		}
	}

	ScaleComposition(this);
}
