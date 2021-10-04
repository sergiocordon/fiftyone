"""
Temporal detection evaluation.

| Copyright 2017-2021, Voxel51, Inc.
| `voxel51.com <https://voxel51.com/>`_
|
"""
import itertools
import logging

import numpy as np

import fiftyone.core.evaluation as foe
import fiftyone.core.fields as fof
import fiftyone.core.labels as fol
import fiftyone.core.validation as fov

from .base import BaseEvaluationResults


logger = logging.getLogger(__name__)


def evaluate_temporal_detections(
    samples,
    pred_field,
    gt_field="ground_truth",
    eval_key=None,
    classes=None,
    missing=None,
    method="activitynet",
    iou=0.50,
    classwise=True,
    **kwargs,
):
    """Evaluates the :class:`fiftyone.core.labels.TemporalDetections` 
    predictions in the given collection with
    respect to the specified ground truth labels. These labels are often used
    for tasks like temporal action detection.

    Args:
        samples: a :class:`fiftyone.core.collections.SampleCollection`
        pred_field: the name of the field containing the predicted
            :class:`fiftyone.core.labels.TemporalDetection` instances
        gt_field ("ground_truth"): the name of the field containing the ground
            truth :class:`fiftyone.core.labels.TemporalDetection` instances
        eval_key (None): an evaluation key to use to refer to this evaluation
        classes (None): the list of possible classes. If not provided, classes
            are loaded from :meth:`fiftyone.core.dataset.Dataset.classes` or
            :meth:`fiftyone.core.dataset.Dataset.default_classes` if
            possible, or else the observed ground truth/predicted labels are
            used
        missing (None): a missing label string. Any None-valued labels are
            given this label for results purposes
        method ("activitynet"): a string specifying the evaluation method to use.
            Supported values are ``("activitynet")``
        iou (0.50): the IoU threshold to use to determine segment matches
        classwise (True): whether to only match segments with the same class
            label (True) or allow matches between classes (False)
        **kwargs: optional keyword arguments for the constructor of the
            :class:`TemporalDetectionEvaluationConfig` being used

    Returns:
        a :class:`TemporalDetectionResults`
    """
    fov.validate_video_collection(samples)

    fov.validate_collection_label_fields(
        samples,
        (pred_field, gt_field),
        (fol.TemporalDetections),
        same_type=True,
    )

    if classes is None:
        if pred_field in samples.classes:
            classes = samples.classes[pred_field]
        elif gt_field in samples.classes:
            classes = samples.classes[gt_field]
        elif samples.default_classes:
            classes = samples.default_classes

    config = _parse_config(
        pred_field, gt_field, method, iou=iou, classwise=classwise, **kwargs,
    )
    eval_method = config.build()
    eval_method.register_run(samples, eval_key)
    eval_method.register_samples(samples)

    if not config.requires_additional_fields:
        _samples = samples.select_fields([gt_field, pred_field])
    else:
        _samples = samples

    if eval_key is not None:
        tp_field = "%s_tp" % eval_key
        fp_field = "%s_fp" % eval_key
        fn_field = "%s_fn" % eval_key

        # note: fields are manually declared so they'll exist even when
        # `samples` is empty
        dataset = samples._dataset
        dataset._add_sample_field_if_necessary(tp_field, fof.IntField)
        dataset._add_sample_field_if_necessary(fp_field, fof.IntField)
        dataset._add_sample_field_if_necessary(fn_field, fof.IntField)

    matches = []
    logger.info("Evaluating temporal detections...")
    # for sample in _samples.iter_samples(progress=True):
    for sample in _samples:
        sample_tp = 0
        sample_fp = 0
        sample_fn = 0
        video_matches = eval_method.evaluate_video(sample, eval_key=eval_key)
        matches.extend(video_matches)

        if eval_key is not None:
            tp, fp, fn = _tally_matches(video_matches)
            sample[tp_field] = tp
            sample[fp_field] = fp
            sample[fn_field] = fn
            sample.save()

    results = eval_method.generate_results(
        samples, matches, eval_key=eval_key, classes=classes, missing=missing
    )
    eval_method.save_run_results(samples, eval_key, results)

    return results


class TemporalDetectionEvaluationConfig(foe.EvaluationMethodConfig):
    """Base class for configuring :class:`TemporalDetectionEvaluation`
    instances.

    Args:
        pred_field: the name of the field containing the predicted
            :class:`fiftyone.core.labels.TemporalDetection` instances
        gt_field: the name of the field containing the ground truth
            :class:`fiftyone.core.labels.TemporalDetection` instances
        iou (None): the IoU threshold to use to determine matches
        classwise (None): whether to only match segments with the same class
            label (True) or allow matches between classes (False)
    """

    def __init__(
        self, pred_field, gt_field, iou=None, classwise=None, **kwargs
    ):
        super().__init__(**kwargs)
        self.pred_field = pred_field
        self.gt_field = gt_field
        self.iou = iou
        self.classwise = classwise

    @property
    def requires_additional_fields(self):
        """Whether fields besides ``pred_field`` and ``gt_field`` are required
        in order to perform evaluation.

        If True then the entire samples will be loaded rather than using
        :meth:`select_fields() <fiftyone.core.collections.SampleCollection.select_fields>`
        to optimize.
        """
        return False


class TemporalDetectionEvaluation(foe.EvaluationMethod):
    """Base class for temporal detection evaluation methods.

    Args:
        config: a :class:`TemporalDetectionEvaluationConfig`
    """

    def __init__(self, config):
        super().__init__(config)
        self.gt_field = None
        self.pred_field = None

    def register_samples(self, samples):
        """Registers the sample collection on which evaluation will be
        performed.

        This method will be called before the first call to
        :meth:`evaluate_video`. Subclasses can extend this method to perform
        any setup required for an evaluation run.

        Args:
            samples: a :class:`fiftyone.core.collections.SampleCollection`
        """
        self.gt_field, _ = samples._handle_frame_field(self.config.gt_field)
        self.pred_field, _ = samples._handle_frame_field(
            self.config.pred_field
        )

    def evaluate_video(self, sample, eval_key=None):
        """Evaluates the ground truth and predicted segments in a video.

        Args:
            sample: a :class:`fiftyone.core.Sample`
            eval_key (None): the evaluation key for this evaluation

        Returns:
            a list of matched ``(gt_label, pred_label, iou, pred_confidence)``
            tuples
        """
        raise NotImplementedError("subclass must implement evaluate_video()")

    def generate_results(
        self, samples, matches, eval_key=None, classes=None, missing=None
    ):
        """Generates aggregate evaluation results for the samples.

        Subclasses may perform additional computations here such as IoU sweeps
        in order to generate mAP, PR curves, etc.

        Args:
            samples: a :class:`fiftyone.core.collections.SampleCollection`
            matches: a list of
                ``(gt_label, pred_label, iou, pred_confidence, gt_id, pred_id)``
                matches. Either label can be ``None`` to indicate an unmatched
                segment
            eval_key (None): the evaluation key for this evaluation
            classes (None): the list of possible classes. If not provided, the
                observed ground truth/predicted labels are used for results
                purposes
            missing (None): a missing label string. Any unmatched segments are
                given this label for results purposes

        Returns:
            a :class:`TemporalDetectionResults`
        """
        return TemporalDetectionResults(
            matches,
            eval_key=eval_key,
            gt_field=self.config.gt_field,
            pred_field=self.config.pred_field,
            classes=classes,
            missing=missing,
            samples=samples,
        )

    def get_fields(self, samples, eval_key):
        pred_field = self.config.pred_field
        pred_type = samples._get_label_field_type(pred_field)
        pred_key = "%s.%s.%s" % (
            pred_field,
            pred_type._LABEL_LIST_FIELD,
            eval_key,
        )

        gt_field = self.config.gt_field
        gt_type = samples._get_label_field_type(gt_field)
        gt_key = "%s.%s.%s" % (gt_field, gt_type._LABEL_LIST_FIELD, eval_key)

        fields = [
            "%s_tp" % eval_key,
            "%s_fp" % eval_key,
            "%s_fn" % eval_key,
            pred_key,
            "%s_id" % pred_key,
            "%s_iou" % pred_key,
            gt_key,
            "%s_id" % gt_key,
            "%s_iou" % gt_key,
        ]

        return fields

    def cleanup(self, samples, eval_key):
        fields = [
            "%s_tp" % eval_key,
            "%s_fp" % eval_key,
            "%s_fn" % eval_key,
        ]

        try:
            pred_type = samples._get_label_field_type(self.config.pred_field)
            pred_key = "%s.%s.%s" % (
                self.config.pred_field,
                pred_type._LABEL_LIST_FIELD,
                eval_key,
            )
            fields.extend([pred_key, "%s_id" % pred_key, "%s_iou" % pred_key])
        except ValueError:
            # Field no longer exists, nothing to cleanup
            pass

        try:
            gt_type = samples._get_label_field_type(self.config.gt_field)
            gt_key = "%s.%s.%s" % (
                self.config.gt_field,
                gt_type._LABEL_LIST_FIELD,
                eval_key,
            )
            fields.extend([gt_key, "%s_id" % gt_key, "%s_iou" % gt_key])
        except ValueError:
            # Field no longer exists, nothing to cleanup
            pass

        samples._dataset.delete_sample_fields(fields, error_level=1)

    def _validate_run(self, samples, eval_key, existing_info):
        self._validate_fields_match(eval_key, "pred_field", existing_info)
        self._validate_fields_match(eval_key, "gt_field", existing_info)


class TemporalDetectionResults(BaseEvaluationResults):
    """Class that stores the results of a temporal detection evaluation.

    Args:
        matches: a list of
            ``(gt_label, pred_label, iou, pred_confidence, gt_id, pred_id)``
            matches. Either label can be ``None`` to indicate an unmatched
            segment
        eval_key (None): the evaluation key for this evaluation
        gt_field (None): the name of the ground truth field
        pred_field (None): the name of the predictions field
        classes (None): the list of possible classes. If not provided, the
            observed ground truth/predicted labels are used
        missing (None): a missing label string. Any unmatched segments are given
            this label for evaluation purposes
        samples (None): the :class:`fiftyone.core.collections.SampleCollection`
            for which the results were computed
    """

    def __init__(
        self,
        matches,
        eval_key=None,
        gt_field=None,
        pred_field=None,
        classes=None,
        missing=None,
        samples=None,
    ):
        if matches:
            ytrue, ypred, ious, confs, ytrue_ids, ypred_ids = zip(*matches)
        else:
            ytrue, ypred, ious, confs, ytrue_ids, ypred_ids = (
                [],
                [],
                [],
                [],
                [],
                [],
            )

        super().__init__(
            ytrue,
            ypred,
            confs=confs,
            eval_key=eval_key,
            gt_field=gt_field,
            pred_field=pred_field,
            ytrue_ids=ytrue_ids,
            ypred_ids=ypred_ids,
            classes=classes,
            missing=missing,
            samples=samples,
        )
        self.ious = np.array(ious)

    @classmethod
    def _from_dict(cls, d, samples, config, **kwargs):
        ytrue = d["ytrue"]
        ypred = d["ypred"]
        ious = d["ious"]

        confs = d.get("confs", None)
        if confs is None:
            confs = itertools.repeat(None)

        ytrue_ids = d.get("ytrue_ids", None)
        if ytrue_ids is None:
            ytrue_ids = itertools.repeat(None)

        ypred_ids = d.get("ypred_ids", None)
        if ypred_ids is None:
            ypred_ids = itertools.repeat(None)

        eval_key = d.get("eval_key", None)
        gt_field = d.get("gt_field", None)
        pred_field = d.get("pred_field", None)
        classes = d.get("classes", None)
        missing = d.get("missing", None)

        matches = list(zip(ytrue, ypred, ious, confs, ytrue_ids, ypred_ids))

        return cls(
            matches,
            eval_key=eval_key,
            gt_field=gt_field,
            pred_field=pred_field,
            classes=classes,
            missing=missing,
            samples=samples,
            **kwargs,
        )


def _parse_config(pred_field, gt_field, method, **kwargs):
    if method is None:
        method = "activitynet"

    if method == "activitynet":
        from .activitynet import ActivityNetEvaluationConfig

        return ActivityNetEvaluationConfig(pred_field, gt_field, **kwargs)

    raise ValueError("Unsupported evaluation method '%s'" % method)


def _tally_matches(matches):
    tp = 0
    fp = 0
    fn = 0
    for match in matches:
        gt_label = match[0]
        pred_label = match[1]
        if gt_label is None:
            fp += 1
        elif pred_label is None:
            fn += 1
        elif gt_label != pred_label:
            fp += 1
            fn += 1
        else:
            tp += 1

    return tp, fp, fn