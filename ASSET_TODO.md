# LAST SALVAGE Asset Notes

## Current usable asset folder

Use this folder for the game:

- `assets/ai-generated/`

Do not use the old prototype folder:

- `assets/generated/`

That folder was an early placeholder pass and does not match the intended quality bar.

## Completed

### Player character

- `assets/ai-generated/characters/scrapper_idle.png`
- `assets/ai-generated/characters/progression/scrapper_stage_01.png`
- `assets/ai-generated/characters/progression/scrapper_stage_02.png`
- `assets/ai-generated/characters/progression/scrapper_stage_03.png`
- `assets/ai-generated/characters/progression/scrapper_stage_04.png`
- `assets/ai-generated/characters/progression/scrapper_stage_05.png`
- `assets/ai-generated/characters/progression/scrapper_stage_06.png`
- `assets/ai-generated/characters/progression/scrapper_stage_07.png`
- `assets/ai-generated/characters/progression/scrapper_stage_08.png`

Player progression concept:

- Same character identity, face, hair, pose, and direction.
- Outfit grows from ragged poor scavenger to legendary survivor.
- All stage files are separate transparent PNGs.

### Enemies and bosses

Enemy direction rule:

- Monsters should feel like they are entering from the right side of the screen and walking left toward the player.
- Use left-facing or 3/4 left-facing poses for future monster assets.

Completed enemy PNGs:

- `assets/ai-generated/enemies/grabber.png`
- `assets/ai-generated/enemies/putrifier.png`
- `assets/ai-generated/enemies/flanker_zombie.png`
- `assets/ai-generated/enemies/armored_zombie.png`
- `assets/ai-generated/enemies/sludge_zombie.png`
- `assets/ai-generated/enemies/drone_zombie.png`
- `assets/ai-generated/enemies/tank_mutant.png`
- `assets/ai-generated/enemies/sewer_raider.png`
- `assets/ai-generated/bosses/colossus_boss.png`
- `assets/ai-generated/bosses/the_herald_boss.png`

### Background and UI

- `assets/ai-generated/backgrounds/combat_ruins_background.png`
- `assets/ai-generated/backgrounds/parallax_l1_sky.png`
- `assets/ai-generated/backgrounds/parallax_l2_factory.png`
- `assets/ai-generated/backgrounds/parallax_l3_wreckage.png`
- `assets/ai-generated/backgrounds/parallax_l4_ground.png`
- `assets/ai-generated/ui/truck_workbench_hub.png`

### Individual weapon icons regenerated cleanly

These were regenerated as individual isolated icons and should be safe to use:

- `assets/ai-generated/weapons/individual/pipe_wrench.png`
- `assets/ai-generated/weapons/individual/saw_blade_stick.png`
- `assets/ai-generated/weapons/individual/electric_shock_wrench.png`
- `assets/ai-generated/weapons/individual/rotary_saw_shield.png`
- `assets/ai-generated/weapons/individual/plasma_shredder.png`
- `assets/ai-generated/weapons/individual/death_windmill.png`
- `assets/ai-generated/weapons/individual/pipe_bomber.png`
- `assets/ai-generated/weapons/individual/molotov.png`
- `assets/ai-generated/weapons/individual/nailgun.png`
- `assets/ai-generated/weapons/individual/poison_gas_canister.png`
- `assets/ai-generated/weapons/individual/emp_railgun.png`
- `assets/ai-generated/weapons/individual/bio_bomb.png`
- `assets/ai-generated/weapons/individual/barbed_wire_trap.png`
- `assets/ai-generated/weapons/individual/trash_can_turret.png`
- `assets/ai-generated/weapons/individual/scrap_mortar.png`
- `assets/ai-generated/weapons/individual/shock_cable.png`
- `assets/ai-generated/weapons/individual/grappling_gun.png`
- `assets/ai-generated/weapons/individual/gravity_disassembler.png`

### Individual UI and item icons

These are split into individual transparent PNGs:

- `assets/ai-generated/ui/individual/tab_crafting.png`
- `assets/ai-generated/ui/individual/tab_skill.png`
- `assets/ai-generated/ui/individual/tab_stats.png`
- `assets/ai-generated/ui/individual/tab_inventory.png`
- `assets/ai-generated/items/individual/coin_reward.png`
- `assets/ai-generated/items/individual/scrap_parts.png`
- `assets/ai-generated/items/individual/skill_point.png`
- `assets/ai-generated/items/individual/notification_badge.png`

### Crafting material icons

These are individual transparent PNGs for weapon crafting recipes:

- `assets/ai-generated/items/materials/plastic_bottle.png`
- `assets/ai-generated/items/materials/cracked_glass_bottle.png`
- `assets/ai-generated/items/materials/rusty_screws.png`
- `assets/ai-generated/items/materials/bent_nails.png`
- `assets/ai-generated/items/materials/bent_metal_pipe.png`
- `assets/ai-generated/items/materials/copper_wire_coil.png`
- `assets/ai-generated/items/materials/duct_tape_roll.png`
- `assets/ai-generated/items/materials/old_battery_cell.png`
- `assets/ai-generated/items/materials/scrap_metal_plate.png`
- `assets/ai-generated/items/materials/broken_circuit_board.png`
- `assets/ai-generated/items/materials/rubber_hose.png`
- `assets/ai-generated/items/materials/crushed_tin_can.png`
- `assets/ai-generated/items/materials/bottle_cap_bundle.png`
- `assets/ai-generated/items/materials/glass_shards.png`
- `assets/ai-generated/items/materials/spring_coil.png`
- `assets/ai-generated/items/materials/gear_fragment.png`
- `assets/ai-generated/items/materials/pressure_valve.png`
- `assets/ai-generated/items/materials/empty_aerosol_can.png`
- `assets/ai-generated/items/materials/torn_cloth_rag.png`
- `assets/ai-generated/items/materials/leather_strap.png`
- `assets/ai-generated/items/materials/spark_plug.png`
- `assets/ai-generated/items/materials/small_electric_motor.png`
- `assets/ai-generated/items/materials/magnet_pair.png`
- `assets/ai-generated/items/materials/rusty_chain_links.png`
- `assets/ai-generated/items/materials/broken_phone.png`
- `assets/ai-generated/items/materials/flashlight_lens.png`
- `assets/ai-generated/items/materials/small_fuel_canister.png`
- `assets/ai-generated/items/materials/ceramic_insulator.png`
- `assets/ai-generated/items/materials/bolt_bundle.png`
- `assets/ai-generated/items/materials/chemical_vial.png`

Some UI/item icons were split from an atlas. Visually inspect them before final use.

## Needs more work

### Weapon icon regeneration complete

All weapon icons listed above were regenerated as standalone isolated PNGs and should be safe to use in-game.

Recommended prompt pattern for future weapon icons:

```text
Create one isolated premium pixel-art game weapon icon for LAST SALVAGE: <weapon name>.
Centered full object, generous padding, no cropping, no other objects.
Perfectly flat solid #00ff00 chroma-key background, no shadow, no text, no watermark.
Do not use #00ff00 in the object.
Crisp chunky pixels, rich shaded mobile game icon quality.
```

Use `#ff00ff` as the chroma key for assets with strong toxic green or teal effects.

### Player animation still needed

The current player progression is idle only. Still needed:

- Walk animation for each outfit stage.
- Attack animation for at least the currently equipped outfit.
- Hit animation.
- Death animation.
- Optional weapon-specific attack overlays.

Recommended animation rule:

- Keep the same face, hair, body proportions, outfit stage, and camera angle.
- Only change limb/weapon pose across frames.

### More item icons likely needed

The current item set is minimal. Future likely item icons:

- Legacy item marker for the will system.
- Recipe discovery card.
- Weapon durability/corrosion warning.
- Health upgrade token.
- Attack upgrade token.
- Defense upgrade token.
- Electric part.
- Toxic part.
- Scrap metal tier variants.

### QA checklist for future assets

- Character, monster, weapon, item, and tab icons should be transparent PNGs.
- Backgrounds and hub panels can be opaque PNGs.
- Monsters should face left, as if approaching from the right.
- No text baked into game assets unless intentionally part of UI.
- Check every generated file on a checkerboard preview before committing.
- Avoid relying only on atlas-split assets unless each cell was generated with enough padding.
