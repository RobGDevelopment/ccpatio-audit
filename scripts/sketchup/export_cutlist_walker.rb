# frozen_string_literal: true
# SketchUp Ruby cut-list walker — names + instance counts + OBB checksum.
#
# Install: copy into Plugins (or Extensions) and restart SketchUp, OR run via
# Window → Ruby Console:
#   load 'C:/Workspace/ccpatio-audit/scripts/sketchup/export_cutlist_walker.rb'
#   CcPatioCutlist.export_active_model
#
# Batch (SketchUp Pro + Ruby Console / extension):
#   CcPatioCutlist.export_folder('C:/path/to/skp', 'C:/path/to/out')
#
# Output JSON matches src/lib/sketchup-cutlist/types.ts WalkerExport.

require 'json'
require 'fileutils'

module CcPatioCutlist
  extend self

  CUT_HINT = /
    \d+\s*" |
    \b(45|90)\b |
    \b2\s*[xX]\s*2\b |
    \b16\s*GA\b |
    \bFLAT\s*BAR\b |
    \bMITRE|\bMITER|\bRAIL|\bARM\b|\bTUBE
  /xi

  def export_active_model(out_path = nil)
    model = Sketchup.active_model
    raise 'No active model' unless model

    path = model.path.to_s
    out = out_path || default_out_path(path.empty? ? 'untitled' : path)
    payload = walk_model(model, path.empty? ? 'untitled.skp' : path)
    FileUtils.mkdir_p(File.dirname(out))
    File.write(out, JSON.pretty_generate(payload))
    puts "CcPatioCutlist wrote #{out} (#{payload['sticks'].length} sticks, bucket=#{payload['auditBucket']})"
    out
  end

  def export_folder(skp_dir, out_dir)
    Dir.glob(File.join(skp_dir, '**', '*.skp')).each do |skp|
      begin
        Sketchup.open_file(skp)
        model = Sketchup.active_model
        next unless model
        base = File.basename(skp, '.skp')
        out = File.join(out_dir, "#{base}.cutlist.json")
        payload = walk_model(model, skp)
        FileUtils.mkdir_p(out_dir)
        File.write(out, JSON.pretty_generate(payload))
        puts "OK #{base} → #{payload['auditBucket']} sticks=#{payload['sticks'].length}"
      rescue => e
        warn "FAIL #{skp}: #{e.message}"
      end
    end
  end

  def walk_model(model, source_file)
    defs = Hash.new { |h, k| h[k] = { count: 0, parents: Hash.new(0), samples: [] } }

    walk_entities(model.entities, nil, Geom::Transformation.new) do |inst, parent_name, _tr|
      defn = inst.definition
      name = defn.name.to_s.strip
      next if name.empty?
      key = name
      defs[key][:count] += 1
      defs[key][:parents][parent_name || '(root)'] += 1
      if defs[key][:samples].length < 3
        defs[key][:samples] << {
          parent: parent_name,
          bounds: definition_bounds_inches(defn, inst)
        }
      end
    end

    sticks = []
    assemblies = []
    cut_like = 0
    named = 0

    defs.each do |name, data|
      named += 1
      cut = !!(name =~ CUT_HINT)
      cut_like += 1 if cut
      parent = data[:parents].max_by { |_k, v| v }&.first
      parent = nil if parent == '(root)'

      if cut || looks_like_stick_bounds?(data[:samples])
        bb = data[:samples].first && data[:samples].first[:bounds]
        parsed = parse_name(name)
        sticks << {
          definitionName: name,
          parentAsmName: parent,
          instanceCount: data[:count],
          nameLengthIn: parsed[:length],
          obbLengthIn: bb && bb[:long],
          endA: parsed[:endA],
          endB: parsed[:endB],
          profile: parsed[:profile],
          profileWidthIn: parsed[:profileWidth],
          materialName: nil,
          confidence: parsed[:length] ? 'stated' : 'low'
        }
      elsif parent.nil? || name =~ /SEAT|ARM|BACK|FRAME|CHAIR/i
        assemblies << { name: name, instanceCount: data[:count] }
      end
    end

    bucket =
      if cut_like >= 3
        'named_cut_strings'
      elsif named >= 5
        'nested_groups'
      else
        'exploded_soup'
      end

    bounds = model.bounds
    {
      sourceFile: source_file,
      exportedAt: Time.now.utc.iso8601,
      productHint: model.title.to_s.empty? ? File.basename(source_file, '.*') : model.title.to_s,
      overall: {
        lengthIn: inches(bounds.width),
        depthIn: inches(bounds.depth),
        heightIn: inches(bounds.height)
      },
      assemblies: assemblies,
      sticks: sticks,
      flags: [],
      auditBucket: bucket
    }
  end

  def walk_entities(entities, parent_name, tr, &block)
    entities.each do |e|
      if e.is_a?(Sketchup::ComponentInstance) || e.is_a?(Sketchup::Group)
        defn = e.respond_to?(:definition) ? e.definition : e.entities.parent
        name = if e.is_a?(Sketchup::Group)
                 e.name.to_s.strip.empty? ? 'Group' : e.name.to_s.strip
               else
                 e.definition.name.to_s.strip
               end
        yield e, parent_name, tr * e.transformation if e.is_a?(Sketchup::ComponentInstance)
        child_parent = name =~ /SEAT|ARM|BACK|CHAIR/i ? name : parent_name
        ents = e.is_a?(Sketchup::Group) ? e.entities : e.definition.entities
        walk_entities(ents, child_parent, tr * e.transformation, &block)
      end
    end
  end

  def definition_bounds_inches(defn, inst)
    b = defn.bounds
    sx = inst.transformation.xscale.abs
    sy = inst.transformation.yscale.abs
    sz = inst.transformation.zscale.abs
    dims = [b.width * sx, b.height * sy, b.depth * sz].map { |v| inches(v) }.sort
    { short: dims[0], mid: dims[1], long: dims[2] }
  end

  def looks_like_stick_bounds?(samples)
    return false if samples.empty?
    bb = samples.first[:bounds]
    return false unless bb
    bb[:long] > 8 && bb[:long] / [bb[:mid], 0.1].max > 3.5
  end

  def parse_name(name)
    profile = 'UNKNOWN'
    width = 2.0
    if name =~ /FLAT\s*BAR|1\/8/i
      profile = 'FB0.125x1.5'
      width = 1.5
    elsif name =~ /1\.5\s*[xX]\s*\.?75/
      profile = 'RT1.5x0.75-16'
      width = 1.5
    elsif name =~ /2\s*[xX]\s*2/
      profile = 'SQ2-16'
      width = 2.0
    elsif name =~ /2\s*[xX]\s*1/
      profile = 'SQ2x1-16'
      width = 2.0
    end

    length = nil
    name.scan(/(\d+(?:\.\d+)?)\s*["″]/).each do |m|
      n = m[0].to_f
      next if n <= 0.25
      length = n
    end

    endA = nil
    endB = nil
    if name =~ /\b(45|90)\s+(45|90)\b/
      endA = $1.to_i
      endB = $2.to_i
    elsif length && profile == 'SQ2-16'
      endA = 90
      endB = 90
    end

    { profile: profile, profileWidth: width, length: length, endA: endA, endB: endB }
  end

  def inches(length)
    # SketchUp internal units are inches
    length.to_f.round(3)
  end

  def default_out_path(source)
    base = File.basename(source.to_s, '.*')
    root = File.expand_path('../../..', __dir__) rescue Dir.pwd
    File.join(root, 'scripts', 'diagnostics', 'cutlist-exports', "#{base}.cutlist.json")
  end
end

puts 'CcPatioCutlist loaded. Call CcPatioCutlist.export_active_model'
